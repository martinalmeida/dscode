import fs from "node:fs/promises";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const listDirectoryTool: ToolDefinition<{ path: string }> = {
  name: "list_directory",
  description: "Lista archivos y carpetas dentro de una ruta del workspace (no recursivo). Útil para explorar la estructura del proyecto antes de leer archivos.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "list_directory",
      description: "Lista archivos y carpetas dentro de una ruta del workspace (no recursivo). Útil para explorar la estructura del proyecto antes de leer archivos.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Ruta del directorio a listar, relativa al workspace. Usa '.' para la raíz." } }, required: ["path"] },
    },
  },
  async execute({ path: relPath }, ctx: ToolContext): Promise<string> {
    const full = resolveSafe(ctx.workspaceDir, relPath);
    const entries = await fs.readdir(full, { withFileTypes: true });
    const ignored = new Set([...APP_CONSTANTS.IGNORED_DIRS, ".DS_Store"]);
    const lines = entries.filter((e) => !ignored.has(e.name)).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
    return lines.length ? lines.join("\n") : "(directorio vacío)";
  },
};
