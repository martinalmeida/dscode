import fs from "node:fs/promises";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const readFileTool: ToolDefinition<{ path: string }> = {
  name: "read_file",
  description: "Lee el contenido completo de un archivo de texto dentro del workspace. Usa esto antes de editar algo, para saber qué hay ahí.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description: "Lee el contenido completo de un archivo de texto dentro del workspace. Usa esto antes de editar algo, para saber qué hay ahí.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Ruta del archivo, relativa a la raíz del workspace." } }, required: ["path"] },
    },
  },
  async execute({ path: relPath }, ctx: ToolContext): Promise<string> {
    const full = resolveSafe(ctx.workspaceDir, relPath);
    const content = await fs.readFile(full, "utf-8");
    const MAX = APP_CONSTANTS.MAX_FILE_READ_CHARS;
    if (content.length > MAX) return content.slice(0, MAX) + `\n\n[...archivo truncado, ${content.length} chars en total...]`;
    return content;
  },
};
