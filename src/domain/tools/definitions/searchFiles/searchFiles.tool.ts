import { execa } from "execa";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const searchFilesTool: ToolDefinition<{ pattern: string; path?: string }> = {
  name: "search_files",
  description: "Busca un texto o patrón regex dentro de los archivos del workspace (como grep -r). Devuelve archivo:línea:contenido de cada coincidencia.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "search_files",
      description: "Busca un texto o patrón regex dentro de los archivos del workspace (como grep -r). Devuelve archivo:línea:contenido de cada coincidencia.",
      parameters: { type: "object", properties: { pattern: { type: "string", description: "Texto o expresión regular (formato grep -E) a buscar." }, path: { type: "string", description: "Carpeta donde buscar, relativa al workspace. Por defecto '.' (todo el proyecto)." } }, required: ["pattern"] },
    },
  },
  async execute({ pattern, path: relPath = "." }, ctx: ToolContext): Promise<string> {
    const full = resolveSafe(ctx.workspaceDir, relPath);
    try {
      const result = await execa("grep", ["-rEn","--exclude-dir=node_modules","--exclude-dir=.git","--",pattern,full], { reject: false, timeout: APP_CONSTANTS.SEARCH_TIMEOUT_MS });
      if (result.exitCode === 2) return `Error en la búsqueda: ${result.stderr || "grep salió con código 2"}`;
      if (!result.stdout) return "(sin coincidencias)";
      return result.stdout.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS ? result.stdout.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...resultados truncados...]" : result.stdout;
    } catch (err) { return `Error en la búsqueda: ${(err as Error).message}`; }
  },
};
