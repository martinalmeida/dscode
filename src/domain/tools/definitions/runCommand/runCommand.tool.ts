import { execa } from "execa";
import { confirm } from "../../../../ui/confirm.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS, BLOCKED_PATTERNS, CONFIRM_PATTERNS } from "../../../../shared/constants.js";

export const runCommandTool: ToolDefinition<{ command: string }> = {
  name: "run_command",
  description: "Ejecuta un comando de shell dentro del workspace. Comandos riesgosos (rm, mv, git reset, etc.) piden confirmación.",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "run_command",
      description: "Ejecuta un comando de shell dentro del workspace (por ejemplo: 'npm test', 'git status').",
      parameters: { type: "object", properties: { command: { type: "string", description: "El comando completo a ejecutar." } }, required: ["command"] },
    },
  },
  async execute({ command }, ctx: ToolContext): Promise<string> {
    if (typeof command !== "string" || !command.trim()) return 'Error: falta el argumento "command" o no es un texto válido.';
    if (BLOCKED_PATTERNS.some((re) => re.test(command))) return `BLOQUEADO: el comando "${command}" coincide con un patrón peligroso y no se ejecutó.`;
    if (CONFIRM_PATTERNS.some((re) => re.test(command))) {
      console.log(`\n[run_command] El agente quiere ejecutar un comando potencialmente riesgoso:`);
      console.log(`  ${command}`);
      const ok = await confirm("¿Confirmas ejecutarlo?", { defaultYes: false });
      if (!ok) return `Cancelado por el usuario: no se ejecutó "${command}".`;
    }
    try {
      const result = await execa(command, { shell: true, cwd: ctx.workspaceDir, timeout: APP_CONSTANTS.COMMAND_TIMEOUT_MS, reject: false });
      const out = [`exit code: ${result.exitCode}`, result.stdout ? `stdout:\n${result.stdout}` : "", result.stderr ? `stderr:\n${result.stderr}` : ""].filter(Boolean).join("\n\n");
      return out.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS ? out.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...salida truncada...]" : out;
    } catch (err) { return `Error ejecutando el comando: ${(err as Error).message}`; }
  },
};
