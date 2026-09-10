import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import { confirm } from "../../../../ui/confirm.js";
import type { ToolContext, ToolDefinition } from "../../types.js";

function normalizeContent(content: string, relPath: string): string {
  const hasLiteral = content.includes("\\n");
  const hasReal = content.includes("\n");
  // Si solo tiene \n literales (caso bug 1 línea), convertir a saltos reales
  if (hasLiteral && !hasReal) {
    const unescaped = content.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"');
    // Si tras unescape hay HTML indentable, lo dejamos; prettier lo formateará después
    return unescaped;
  }
  // Si tiene ambos pero predominan literales (ej 13 literales vs 1 real), convertir literales
  if (hasLiteral && hasReal) {
    const literalCount = (content.match(/\\n/g) || []).length;
    const realCount = (content.match(/\n/g) || []).length;
    if (literalCount > realCount) {
      return content.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
  }
  // Normalizar \n literales sueltos en archivos indentables siempre (html/md/css/js)
  if (hasLiteral && /\.(html|css|js|ts|jsx|tsx|md|json)$/.test(relPath)) {
    // Solo si el contenido parece tener tags sin saltos reales entre ellos
    if (content.includes("\\n<") || content.includes("\\n ")) {
      return content.replace(/\\n/g, "\n");
    }
  }
  return content;
}

async function formatWithPrettier(content: string, relPath: string): Promise<string> {
  const ext = path.extname(relPath).toLowerCase();
  let parser: string | null = null;
  if (ext === ".html" || ext === ".htm") parser = "html";
  else if (ext === ".css") parser = "css";
  else if (ext === ".js" || ext === ".jsx") parser = "babel";
  else if (ext === ".ts" || ext === ".tsx") parser = "typescript";
  else if (ext === ".json") parser = "json";
  else if (ext === ".md") parser = "markdown";
  if (!parser) return content;
  // Solo formatear si parece tener estructura indentable y más de 2 líneas tras normalize
  if (content.split("\n").length < 3) return content;
  try {
    const prettier = await import("prettier");
    const formatted = await (prettier as unknown as { format: (c: string, o: unknown) => Promise<string> }).format(content, { parser, tabWidth: 2, useTabs: false, semi: true, singleQuote: false });
    return formatted;
  } catch (_e) { void _e; return content; }
}

export const writeFileTool: ToolDefinition<{ path: string; content: string }> = {
  name: "write_file",
  description: "Crea o sobrescribe un archivo de texto dentro del workspace con indentación humana (2 espacios, cada tag/bloque en línea separada). Requiere SIEMPRE {path, content} no vacíos. Normaliza \\n literales a saltos reales y crea carpetas intermedias si no existen. Usa edit_file para cambios parciales.",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "Crea o sobrescribe un archivo de texto dentro del workspace con indentación humana (2 espacios). Requiere SIEMPRE {path, content} no vacíos. Normaliza \\n literales a saltos reales y crea carpetas intermedias si no existen.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Ruta del archivo, relativa a la raíz del workspace. Obligatorio, no vacío. Ej: \"hola.md\" o \"docs/nota.md\"." }, content: { type: "string", description: "Contenido completo a escribir en el archivo con indentación a 2 espacios (no minificado, cada tag en línea separada). Obligatorio (puede ser \"\" si quieres archivo vacío). Los \\n se convierten en saltos reales." } }, required: ["path","content"] },
    },
  },
  async execute({ path: relPath, content }, ctx: ToolContext): Promise<string> {
    if (typeof relPath !== "string" || !relPath) return 'Faltan argumentos para write_file: "path" es obligatorio y no vacío. Vuelve a llamar a write_file con {"path":"<ruta-relativa>","content":"<texto>"}. Ej: {"path":"hola.md","content":"# Hola\\nhola como estas"}';
    if (typeof content !== "string") return 'Falta "content" para write_file: es obligatorio (usa "" si quieres archivo vacío). Vuelve a llamar a write_file incluyendo "content". Ej: {"path":"hola.md","content":"# Hola\\nhola como estas"}';
    // Normalizar \n literales a saltos reales (fix archivo en 1 línea) antes de cualquier otra cosa
    content = normalizeContent(content, relPath);
    // Formatear con prettier para indentación humana equilibrada (2 espacios)
    content = await formatWithPrettier(content, relPath);
    const full = resolveSafe(ctx.workspaceDir, relPath);
    if (full === path.resolve(ctx.workspaceDir)) return "Error: la ruta resuelve a la raíz del workspace, no a un archivo.";
    const existedBefore = await fs.access(full).then(()=>true).catch(()=>false);
    if (existedBefore) {
      const previous = await fs.readFile(full,"utf-8").catch(()=> "");
      const preview = buildDiffPreview(previous, content);
      ctx.pauseSpinner?.();
      ctx.pauseInput?.();
      console.log(`\n[write_file] Vas a SOBRESCRIBIR un archivo existente: ${relPath}`);
      console.log(preview);
      const ok = await confirm(`¿Confirmas sobrescribir "${relPath}"?`, { defaultYes: false });
      ctx.resumeInput?.();
      ctx.resumeSpinner?.(`Ejecutando write_file`);
      if (!ok) return `Cancelado por el usuario: no se sobrescribió "${relPath}".`;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
    return `Archivo ${existedBefore ? "sobrescrito" : "creado"}: ${relPath} (${content.length} caracteres, ${content.split("\n").length} líneas).`;
  },
};

function buildDiffPreview(previous: string, next: string): string {
  const prevLines = previous.split("\n");
  const nextLines = next.split("\n");
  const summary = [`  Antes: ${prevLines.length} líneas, ${previous.length} caracteres`, `  Después: ${nextLines.length} líneas, ${next.length} caracteres`];
  const maxLines = Math.max(prevLines.length, nextLines.length);
  for (let i = 0; i < maxLines; i++) if (prevLines[i] !== nextLines[i]) { summary.push(`  Primera diferencia en la línea ${i+1}:`); summary.push(`    - ${prevLines[i] ?? "(sin línea)"}`); summary.push(`    + ${nextLines[i] ?? "(sin línea)"}`); break; }
  return summary.join("\n");
}
