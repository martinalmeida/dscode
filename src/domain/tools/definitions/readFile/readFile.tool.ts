import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const readFileTool: ToolDefinition<{ path: string; offset?: number; limit?: number }> = {
  name: "read_file",
  description:
    "Lee el contenido completo de un archivo de texto dentro del workspace. Soporta paginación offset/limit para archivos grandes (heavy). Usa esto antes de editar algo, para saber qué hay ahí. Si omites la extensión, igual sugiere coincidencias.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Lee el contenido completo de un archivo de texto dentro del workspace. Soporta offset/limit para paginar archivos grandes. Usa esto antes de editar algo, para saber qué hay ahí. Si omites la extensión, igual sugiere coincidencias.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Ruta del archivo, relativa al workspace. Si omites extensión, se sugieren coincidencias (ej: "xddvd" → "xddvd.md").',
          },
          offset: {
            type: "number",
            description: 'Offset en chars desde el inicio (0 por defecto). SOLO usa si la respuesta anterior terminó en [...archivo paginado...] con "usa offset X". Si no viste ese marcador, NO pagines.',
          },
          limit: {
            type: "number",
            description: "Límite de chars a leer desde offset (por defecto MAX_FILE_READ_CHARS). Máx 40000. Solo tras ver [...archivo paginado...].",
          },
        },
        required: ["path"],
      },
    },
  },
  async execute({ path: relPath, offset, limit }, ctx: ToolContext): Promise<string> {
    const full = resolveSafe(ctx.workspaceDir, relPath);
    try {
      const content = await fs.readFile(full, "utf-8");
      const MAX = APP_CONSTANTS.MAX_FILE_READ_CHARS;
      const off = Math.max(0, Math.floor(offset ?? 0));
      if (off >= content.length) throw new Error(`offset ${off} >= ${content.length} total chars en "${relPath}" — archivo tiene ${content.length} chars, no necesita paginación. Usa read_file sin offset o con offset < ${content.length}.`);
      const lim = Math.min(MAX, Math.max(1, Math.floor(limit ?? MAX)));
      if (off > 0 || content.length > lim) {
        const slice = content.slice(off, off + lim);
        const truncated = off + lim < content.length;
        const header = off > 0 ? `[offset ${off}/${content.length} chars]\n` : "";
        return header + slice + (truncated ? `\n\n[...archivo paginado, ${content.length} chars total, mostrando ${off}-${off + slice.length}... usa offset ${off + slice.length} para continuar]` : "");
      }
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
