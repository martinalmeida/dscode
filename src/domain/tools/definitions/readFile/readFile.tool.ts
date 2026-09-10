import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const readFileTool: ToolDefinition<{ path: string }> = {
  name: "read_file",
  description:
    "Lee el contenido completo de un archivo de texto dentro del workspace. Usa esto antes de editar algo, para saber qué hay ahí. Si omites la extensión, igual sugiere coincidencias.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Lee el contenido completo de un archivo de texto dentro del workspace. Usa esto antes de editar algo, para saber qué hay ahí. Si omites la extensión, igual sugiere coincidencias.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Ruta del archivo, relativa al workspace. Si omites extensión, se sugieren coincidencias (ej: "xddvd" → "xddvd.md").',
          },
        },
        required: ["path"],
      },
    },
  },
  async execute({ path: relPath }, ctx: ToolContext): Promise<string> {
    const full = resolveSafe(ctx.workspaceDir, relPath);
    try {
      const content = await fs.readFile(full, "utf-8");
      const MAX = APP_CONSTANTS.MAX_FILE_READ_CHARS;
      if (content.length > MAX)
        return (
          content.slice(0, MAX) + `\n\n[...archivo truncado, ${content.length} chars en total...]`
        );
      return content;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
      // Sugerir candidatos sin extensión
      const dir = path.dirname(full);
      const base = path.basename(relPath);
      const stem = base.toLowerCase();
      let hints = "";
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const candidates = entries
          .filter((en) => en.isFile() && path.parse(en.name).name.toLowerCase() === stem)
          .map((en) =>
            path
              .join(path.dirname(relPath) === "." ? "" : path.dirname(relPath), en.name)
              .replace(/^\//, "")
          )
          .slice(0, 5);
        if (candidates.length === 0) {
          const lax = entries
            .filter((en) => en.isFile() && en.name.toLowerCase().includes(stem))
            .map((en) =>
              path
                .join(path.dirname(relPath) === "." ? "" : path.dirname(relPath), en.name)
                .replace(/^\//, "")
            )
            .slice(0, 5);
          if (lax.length > 0) candidates.push(...lax);
        }
        if (candidates.length > 0)
          hints = ` Coincidencias sin extensión en "${path.dirname(relPath)}": ${candidates.join(", ")} — reintenta con {"path":"${candidates[0]}"} o usa search_files pattern "${base}".`;
      } catch (_e) {
        void _e;
      }
      const msg = `No existe: "${relPath}".${hints || " Verifica la ruta con list_directory."}`;
      throw new Error(msg);
    }
  },
};
