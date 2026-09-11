import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

const MAX_PATHS = 20;

export const readManyFilesTool: ToolDefinition<{ paths: string[] }> = {
  name: "read_many_files",
  description:
    "Lee múltiples archivos en un solo llamado batch. Ideal para proyectos grandes/polyglot: pasa 5-20 rutas y obtienes todos los contenidos concatenados. Respeta workspace + IGNORED_DIRS para glob, pero sí lee dotfiles (.env) si los pides explícitamente.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "read_many_files",
      description:
        "Lee múltiples archivos en batch. Pasa un array de rutas relativas al workspace (ej: [\"src/index.ts\",\"src/app/agent/prompt.ts\",\".env\"]). Máx 20 por llamado.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description:
              'Rutas relativas al workspace. Cualquier extensión/nombre, incluidos dotfiles (.env) si los incluyes explícitamente. Máx 20.',
          },
        },
        required: ["paths"],
      },
    },
  },
  async execute({ paths }, ctx: ToolContext): Promise<string> {
    if (!Array.isArray(paths) || paths.length === 0)
      return 'Error: falta "paths" (array no vacío de rutas). Ej: {"paths":["src/index.ts",".env"]}';
    if (paths.length > MAX_PATHS)
      return `Error: máximo ${MAX_PATHS} paths por llamado, recibidos ${paths.length}. Divide en 2 llamados.`;

    const blocks: string[] = [];
    let totalChars = 0;

    for (const relPath of paths) {
      if (typeof relPath !== "string" || !relPath.trim()) {
        blocks.push(`--- (path vacío/inválido) ---\n[skip]\n--- fin ---`);
        continue;
      }
      let full: string;
      try {
        full = resolveSafe(ctx.workspaceDir, relPath.trim());
      } catch (err) {
        blocks.push(`--- ${relPath} ---\n[Error: ${(err as Error).message}]\n--- fin de ${relPath} ---`);
        continue;
      }
      try {
        const content = await fs.readFile(full, "utf-8");
        const MAX = APP_CONSTANTS.MAX_FILE_READ_CHARS;
        const sliced = content.length > MAX ? content.slice(0, MAX) + `\n\n[...archivo truncado, ${content.length} chars...]` : content;
        const block = `--- ${relPath} ---\n${sliced}\n--- fin de ${relPath} ---`;
        // Guard global para no explotar MAX_TOOL_RESULT_CHARS
        if (totalChars + block.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) {
          const remaining = APP_CONSTANTS.MAX_TOOL_RESULT_CHARS - totalChars;
          if (remaining > 200) blocks.push(block.slice(0, remaining) + "\n[...batch truncado por MAX_TOOL_RESULT_CHARS...]");
          else blocks.push(`[...batch truncado: faltan ${paths.length - blocks.length} archivos por límite de chars...]`);
          break;
        }
        blocks.push(block);
        totalChars += block.length;
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        let msg = `No existe: "${relPath}".`;
        if (err.code === "ENOENT") {
          // Sugerencia rápida sin extensión
          try {
            const dir = path.dirname(full);
            const base = path.basename(relPath.trim());
            const stem = base.toLowerCase();
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const candidates = entries
              .filter((en) => en.isFile() && path.parse(en.name).name.toLowerCase() === stem)
              .map((en) => path.join(path.dirname(relPath) === "." ? "" : path.dirname(relPath), en.name).replace(/^\//, ""))
              .slice(0, 3);
            if (candidates.length > 0) msg += ` Sugerencias: ${candidates.join(", ")}`;
            else {
              const lax = entries
                .filter((en) => en.isFile() && en.name.toLowerCase().includes(stem))
                .map((en) => path.join(path.dirname(relPath) === "." ? "" : path.dirname(relPath), en.name).replace(/^\//, ""))
                .slice(0, 3);
              if (lax.length > 0) msg += ` Sugerencias: ${lax.join(", ")}`;
            }
          } catch (_e) {
            void _e;
          }
        } else {
          msg = `Error leyendo "${relPath}": ${(e as Error).message}`;
        }
        const block = `--- ${relPath} ---\n[${msg}]\n--- fin de ${relPath} ---`;
        if (totalChars + block.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) {
          blocks.push(`[...batch truncado...]`);
          break;
        }
        blocks.push(block);
        totalChars += block.length;
      }
    }

    const out = blocks.join("\n\n");
    if (out.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) return out.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...resultados truncados...]";
    return out || "(sin contenido)";
  },
};
