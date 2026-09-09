import { execa } from "execa";
import { confirm } from "../ui/confirm.js";

export const schema = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Ejecuta un comando de shell dentro del workspace (por ejemplo: 'npm test', " +
      "'git status', 'ls -la'). Usa esto para correr tests, builds o comandos git. " +
      "El comando corre con permisos de tu usuario, así que ten cuidado con lo que pides. " +
      "Comandos que borran, mueven o sobrescriben archivos (rm, mv, git reset --hard, " +
      "git checkout -- , etc.) le van a pedir confirmación al usuario antes de correr.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "El comando completo a ejecutar, ej: 'npm run build'.",
        },
      },
      required: ["command"],
    },
  },
};

// Lista mínima de patrones que bloqueamos pase lo que pase, sin excepción.
// No es un sandbox real, es solo un cinturón de seguridad barato.
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\S)/, // rm -rf / a secas
  /:\(\)\{.*:\|:&.*\};:/, // fork bomb clásica
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

// Patrones que no se bloquean, pero sí piden confirmación humana antes de
// correr — porque pueden borrar o sobrescribir cosas de forma irreversible.
const RISKY_PATTERNS = [
  /\brm\b/,
  /\bmv\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+checkout\s+--/,
  /\bgit\s+clean\b/,
  /\bgit\s+push\s+.*--force/,
  />\s*[^&]/, // redirección que sobrescribe un archivo
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
];

export async function execute({ command }, ctx) {
  if (typeof command !== "string" || !command.trim()) {
    return 'Error: falta el argumento "command" o no es un texto válido.';
  }

  if (BLOCKED_PATTERNS.some((re) => re.test(command))) {
    return `BLOQUEADO: el comando "${command}" coincide con un patrón peligroso y no se ejecutó.`;
  }

  if (RISKY_PATTERNS.some((re) => re.test(command))) {
    console.log(`\n[run_command] El agente quiere ejecutar un comando potencialmente riesgoso:`);
    console.log(`  ${command}`);
    const ok = await confirm("¿Confirmas ejecutarlo?", { defaultYes: false });
    if (!ok) {
      return `Cancelado por el usuario: no se ejecutó "${command}".`;
    }
  }

  try {
    const result = await execa(command, {
      shell: true,
      cwd: ctx.workspaceDir,
      timeout: 60_000,
      reject: false, // no lanzar excepción si el comando sale con código != 0
    });

    const out = [
      `exit code: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return out.length > 8000 ? out.slice(0, 8000) + "\n[...salida truncada...]" : out;
  } catch (err) {
    return `Error ejecutando el comando: ${err.message}`;
  }
}
