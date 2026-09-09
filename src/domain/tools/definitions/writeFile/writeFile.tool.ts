import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import { confirm } from "../../../../ui/confirm.js";
import type { ToolContext, ToolDefinition } from "../../types.js";

export const writeFileTool: ToolDefinition<{ path: string; content: string }> = {
  name: "write_file",
  description: "Crea o sobrescribe un archivo de texto dentro del workspace con el contenido dado. Crea las carpetas intermedias si no existen.",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "Crea o sobrescribe un archivo de texto dentro del workspace con el contenido dado. Crea las carpetas intermedias si no existen.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Ruta del archivo, relativa a la raíz del workspace." }, content: { type: "string", description: "Contenido completo a escribir en el archivo." } }, required: ["path","content"] },
    },
  },
  async execute({ path: relPath, content }, ctx: ToolContext): Promise<string> {
    if (typeof relPath !== "string" || !relPath) return 'Error: falta el argumento "path" o no es un texto válido.';
    if (typeof content !== "string") return 'Error: falta el argumento "content" o no es un texto válido.';
    const full = resolveSafe(ctx.workspaceDir, relPath);
    if (full === path.resolve(ctx.workspaceDir)) return "Error: la ruta resuelve a la raíz del workspace, no a un archivo.";
    const existedBefore = await fs.access(full).then(()=>true).catch(()=>false);
    if (existedBefore) {
      const previous = await fs.readFile(full,"utf-8").catch(()=> "");
      const preview = buildDiffPreview(previous, content);
      console.log(`\n[write_file] Vas a SOBRESCRIBIR un archivo existente: ${relPath}`);
      console.log(preview);
      const ok = await confirm(`¿Confirmas sobrescribir "${relPath}"?`, { defaultYes: false });
      if (!ok) return `Cancelado por el usuario: no se sobrescribió "${relPath}".`;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
    return `Archivo ${existedBefore ? "sobrescrito" : "creado"}: ${relPath} (${content.length} caracteres).`;
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
