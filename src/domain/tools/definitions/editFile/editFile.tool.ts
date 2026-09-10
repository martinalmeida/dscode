import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";

function normalizeEditString(s: string): string {
  // Convierte \n literales a saltos reales si predominan
  if (s.includes("\\n") && !s.includes("\n"))
    return s.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
  if (s.includes("\\n") && s.includes("\n")) {
    const lit = (s.match(/\\n/g) || []).length;
    const real = (s.match(/\n/g) || []).length;
    if (lit > real) return s.replace(/\\n/g, "\n");
  }
  return s;
}

function findFuzzyMatch(content: string, needle: string): string | null {
  // Match ignorando indentación (trim por línea) — resuelve caso 1 espacio vs 2/4 espacios de write_file
  const cLines = content.split("\n");
  const nLinesRaw = needle.split("\n");
  // Evitar trailing empty por split final
  const last = nLinesRaw[nLinesRaw.length - 1];
  const nLines = last === "" ? nLinesRaw.slice(0, -1) : nLinesRaw;
  const nTrimmed = nLines.map((l) => l.trim());
  if (nTrimmed.length === 0 || nTrimmed.every((l) => l === "")) return null;
  const matches: Array<{ start: number; text: string }> = [];
  for (let i = 0; i <= cLines.length - nTrimmed.length; i++) {
    let ok = true;
    for (let j = 0; j < nTrimmed.length; j++) {
      const cTrim = (cLines[i + j] ?? "").trim();
      if (cTrim !== nTrimmed[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const text = cLines.slice(i, i + nLines.length).join("\n");
      matches.push({ start: i, text });
    }
  }
  const first = matches[0];
  if (matches.length === 1 && first) return first.text;
  return null;
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
  if (content.split("\n").length < 3) return content;
  try {
    const prettier = await import("prettier");
    const formatted = await (
      prettier as unknown as { format: (c: string, o: unknown) => Promise<string> }
    ).format(content, { parser, tabWidth: 2, useTabs: false });
    return formatted;
  } catch (_e) {
    void _e;
    return content;
  }
}

export const editFileTool: ToolDefinition<{
  path: string;
  old_string: string;
  new_string: string;
}> = {
  name: "edit_file",
  description:
    "Edita una fracción de un archivo existente sin reescribirlo todo. Requiere {path, old_string, new_string} exactos con indentación. Preserva indentación humana (2 espacios). Usa read_file primero para copiar old_string.",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edita una fracción de un archivo existente sin reescribirlo todo. Requiere {path, old_string, new_string} exactos con indentación. Preserva indentación humana (2 espacios). Usa read_file primero para copiar old_string.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Ruta del archivo existente, relativa a raíz. Ej: "index.html"',
          },
          old_string: {
            type: "string",
            description:
              "Fragmento exacto a reemplazar, incluyendo indentación y saltos (copiado de read_file). Debe ser único en el archivo.",
          },
          new_string: {
            type: "string",
            description:
              "Nuevo contenido que reemplazará old_string, con indentación a 2 espacios.",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  async execute({ path: relPath, old_string, new_string }, ctx: ToolContext): Promise<string> {
    if (typeof relPath !== "string" || !relPath)
      return 'Falta "path" para edit_file. Ej: {"path":"index.html","old_string":"  <title>Viejo</title>","new_string":"  <title>Nuevo</title>"}';
    if (typeof old_string !== "string" || !old_string)
      return 'Falta "old_string" para edit_file: debe ser el fragmento exacto a reemplazar (incluye indentación). Lee el archivo con read_file primero.';
    if (typeof new_string !== "string")
      return 'Falta "new_string" para edit_file: es obligatorio (puede ser "" para borrar).';
    const normOld = normalizeEditString(old_string);
    const normNew = normalizeEditString(new_string);
    const full = resolveSafe(ctx.workspaceDir, relPath);
    let original: string;
    try {
      original = await fs.readFile(full, "utf-8");
    } catch {
      return `No existe "${relPath}". Verifica con list_directory o crea con write_file.`;
    }
    // Normalizar literales en original también si estuviera corrupto (1 línea con \\n)
    let working = original;
    if (working.includes("\\n") && !working.includes("\n")) {
      working = working.replace(/\\n/g, "\n");
    }
    let targetOld: string | null = null;
    let occurrences = 0;
    if (working.includes(normOld)) {
      targetOld = normOld;
      occurrences = working.split(targetOld).length - 1;
    } else if (working.includes(old_string)) {
      targetOld = old_string;
      occurrences = working.split(targetOld).length - 1;
    } else {
      // Fallback fuzzy: ignora indentación (trim por línea) para tolerar 1 vs 2 espacios del LLM
      const fuzzy = findFuzzyMatch(working, normOld) ?? findFuzzyMatch(working, old_string);
      if (fuzzy && working.includes(fuzzy)) {
        targetOld = fuzzy;
        occurrences = working.split(targetOld).length - 1;
        if (occurrences === 1) {
          // usar el fragmento real del archivo (con indentación correcta) pero loggear que fue fuzzy
          ctx.logger?.debug?.(
            {
              fuzzy: true,
              needlePreview: normOld.slice(0, 80),
              matchedPreview: fuzzy.slice(0, 80),
            },
            "edit_file fuzzy indent match"
          );
        }
      }
      if (!targetOld) {
        return `old_string no encontrado en "${relPath}". Asegúrate de copiar exacto desde read_file (incluye 2 espacios de indentación y saltos). Usa search_files para localizar el fragmento. Tip: si copiaste con 1 espacio y el archivo tiene 2/4, ahora se intenta fuzzy pero falló — incluye 3-5 líneas exactas con indentación.`;
      }
    }
    if (occurrences === 0) return `old_string no encontrado en "${relPath}".`;
    if (occurrences > 1)
      return `old_string aparece ${occurrences} veces en "${relPath}". Añade más contexto (3-5 líneas alrededor con indentación) para que sea único.`;
    let next = working.replace(targetOld, normNew);
    // Formatear resultado para mantener indentación humana equilibrada
    next = await formatWithPrettier(next, relPath);
    await fs.writeFile(full, next, "utf-8");
    return `Editado: ${relPath} (reemplazo único, ${original.length}→${next.length} chars, ${next.split("\n").length} líneas).`;
  },
};
