import fg from "fast-glob";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const globTool: ToolDefinition<{ pattern: string; path?: string }> = {
  name: "glob",
  description:
    "Búsqueda rápida por patrón glob (ej: **/*.ts, src/**/*.{js,ts}, **/.env). Respeta IGNORED_DIRS (node_modules, vendor, etc.) y soporta **, *, {}, !. Devuelve hasta 200 paths relativos. Ideal para descubrir archivos multi-tech antes de read_many_files.",
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
            description:
              "Carpeta base relativa al workspace donde aplicar el glob. Por defecto '.'",
          },
        },
        required: ["pattern"],
      },
    },
  },
  async execute({ pattern, path: relPath = "." }, ctx: ToolContext): Promise<string> {
    if (typeof pattern !== "string" || !pattern.trim())
      return (
        'Error: falta "pattern" string (ej: "**/*.ts", "src/**/*.tsx"). Recibido: ' +
        JSON.stringify(pattern)
      );
    const pat = pattern.trim();
    // Antipatrón real: bare extension sin nombre ni *, ej "pages/.tsx" o "**/.tsx"
    // (typo por "*.tsx"). OJO: esto NO debe atrapar dotfiles legítimos como
    // "**/.env", "**/.gitignore", "**/.eslintrc" — esos son nombres de archivo
    // completos, no una extensión con el * olvidado.
    const CODE_EXT_TYPOS = new Set([
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "json",
      "md",
      "css",
      "scss",
      "less",
      "html",
      "htm",
      "py",
      "go",
      "rs",
      "java",
      "kt",
      "rb",
      "php",
      "c",
      "cpp",
      "h",
      "hpp",
      "yml",
      "yaml",
      "vue",
      "svelte",
      "sql",
    ]);
    const bareExtMatch = pat.match(/(?:^|\/)\.(\w+)$/);
    if (bareExtMatch && CODE_EXT_TYPOS.has(bareExtMatch[1]!.toLowerCase())) {
      return `Error: pattern "${pat}" inválido — parece que falta * antes de la extensión. Usa "**/*.${bareExtMatch[1]}" o "apps/web/src/pages/*.${bareExtMatch[1]}", no "apps/web/src/pages/.${bareExtMatch[1]}". (Si buscabas un dotfile real como ".env" o ".gitignore", esos sí son válidos tal cual.)`;
    }
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
      const sliced = entries.slice(0, APP_CONSTANTS.GLOB_LIMIT);
      const out = sliced.join("\n");
      const truncated =
        entries.length > APP_CONSTANTS.GLOB_LIMIT
          ? `\n[...${entries.length - APP_CONSTANTS.GLOB_LIMIT} más no mostrados...]`
          : "";
      const result = out + truncated;
      if (result.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS)
        return (
          result.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...resultados truncados...]"
        );
      return result;
    } catch (err) {
      return `Error glob "${pattern}": ${(err as Error).message}`;
    }
  },
};
