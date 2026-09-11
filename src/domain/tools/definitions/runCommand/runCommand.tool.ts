import { execa } from "execa";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS, BLOCKED_PATTERNS } from "../../../../shared/constants.js";

export const runCommandTool: ToolDefinition<{ command: string; workdir?: string }> = {
  name: "run_command",
  description:
    "Ejecuta un comando de shell dentro del workspace. Autónomo: ejecuta inmediato si el LLM lo ordena, solo bloquea patrones críticos (rm -rf /, mkfs, etc.).",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Ejecuta un comando de shell dentro del workspace (por ejemplo: 'npm test', 'git status').",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "El comando completo a ejecutar." },
          workdir: {
            type: "string",
            description:
              "Subcarpeta del workspace donde ejecutar el comando, relativa al workspace. Por defecto '.' (raíz del workspace). Respetado por resolveSafe — nunca sale del workspace.",
          },
        },
        required: ["command"],
      },
    },
  },
  async execute({ command, workdir }, ctx: ToolContext): Promise<string> {
    if (typeof command !== "string" || !command.trim())
      return 'Error: falta el argumento "command" o no es un texto válido.';
    if (BLOCKED_PATTERNS.some((re) => re.test(command)))
      return `BLOQUEADO: el comando "${command}" coincide con un patrón peligroso y no se ejecutó.`;
    let cwd = ctx.workspaceDir;
    if (typeof workdir === "string" && workdir.trim() && workdir.trim() !== ".") {
      try {
        cwd = resolveSafe(ctx.workspaceDir, workdir.trim());
      } catch (err) {
        return `Error: workdir fuera del workspace: "${workdir}" — ${(err as Error).message}`;
      }
    }
    try {
      const result = await execa(command, {
        shell: true,
        cwd,
        timeout: APP_CONSTANTS.COMMAND_TIMEOUT_MS,
        reject: false,
      });
      const out = [
        `exit code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return out.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
        ? out.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...salida truncada...]"
        : out;
    } catch (err) {
      return `Error ejecutando el comando: ${(err as Error).message}`;
    }
  },
};
