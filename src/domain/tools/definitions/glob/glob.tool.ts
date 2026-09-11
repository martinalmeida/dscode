import fg from "fast-glob";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const globTool: ToolDefinition<{ pattern: string; path?: string }> = {
  name: "glob",
  description:
    "Búsqueda rápida por patrón glob (ej: **/*.ts, src/**/*.{js,ts}, **/.env). Respeta IGNORED_DIRS (node_modules, vendor, etc.) y soporta **, *, {}, !. Devuelve hasta 100 paths relativos. Ideal para descubrir archivos multi-tech antes de read_many_files.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "glob",
      description:
        "Busca archivos por glob. Ej: pattern='**/*.ts' o 'src/**/*.js' . Respeta IGNORED_DIRS automático.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: 'Patrón glob. Ej: "**/*.ts", "src/**/*.{js,ts}", "**/.env", "**/*.md"',
          },
          path: {
            type: "string",
            description: "Carpeta base relativa al workspace donde aplicar el glob. Por defecto '.'",
          },
        },
        required: ["pattern"],
      },
    },
  },
  async execute({ pattern, path: relPath = "." }, ctx: ToolContext): Promise<string> {
    if (!pattern || !pattern.trim()) return 'Error: falta "pattern" (ej: "**/*.ts").';
    const base = resolveSafe(ctx.workspaceDir, relPath);
    const ignore = [...APP_CONSTANTS.IGNORED_DIRS].map((d) => `**/${d}/**`);
    try {
      const entries = await fg(pattern.trim(), {
        cwd: base,
        dot: true,
        onlyFiles: true,
        ignore,
        absolute: false,
        suppressErrors: true,
      });
      if (entries.length === 0) return `(sin coincidencias para glob "${pattern}" en "${relPath}")`;
      const sliced = entries.slice(0, 100);
      const out = sliced.join("\n");
      const truncated = entries.length > 100 ? `\n[...${entries.length - 100} más no mostrados...]` : "";
      const result = out + truncated;
      if (result.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS)
        return result.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...resultados truncados...]";
      return result;
    } catch (err) {
      return `Error glob "${pattern}": ${(err as Error).message}`;
    }
  },
};
