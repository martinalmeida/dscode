import { execa } from "execa";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS, BLOCKED_PATTERNS } from "../../../../shared/constants.js";

export const runCommandTool: ToolDefinition<{ command: string; workdir?: string }> = {
  name: "run_command",
  description:
    "Ejecuta comandos de runtime/diagnóstico dentro del workspace. Las mutaciones directas de archivos están bloqueadas; usa las tools de edición controlada. Operaciones de infraestructura como docker/podman compose sí están permitidas.",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Ejecuta un comando de shell dentro del workspace (por ejemplo: 'npm test', 'git status'). Para modificar archivos usa preferentemente edit_file/apply_patch/write_file; los comandos de shell que cambien archivos previamente leídos invalidarán sus snapshots y obligarán a una nueva lectura.",
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

    // Los cambios directos al filesystem desde shell destruyen el modelo de
    // snapshots y pueden hacer que el agente borre o sobrescriba archivos de
    // configuración durante una recuperación. Las mutaciones de código deben
    // pasar por las tools de edición controlada. Se permiten operaciones de
    // runtime como docker compose y gestores de paquetes.
    // Clasificación deliberadamente conservadora: comandos de lectura como
    // `ls | grep ... | cat` no deben bloquearse. Solo bloqueamos operaciones
    // cuyo verbo/comando implica una mutación directa del filesystem o del
    // historial Git. La infraestructura (docker/podman compose) sigue permitida.
    const shellSegments = command
      .split(/\s*(?:&&|\|\||;|\n)\s*/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const directMutation = shellSegments.some((segment) => {
      if (/^(?:rm|rmdir|del)(?:\s|$)/i.test(segment)) return true;
      if (/^(?:mv|cp)(?:\s|$)/i.test(segment)) return true;
      if (/^(?:sed|perl)(?:\s|$)/i.test(segment) && /(?:^|\s)(?:-i|--in-place)(?:\s|$)/i.test(segment)) return true;
      if (/^(?:tee)(?:\s|$)/i.test(segment)) return true;
      if (/^(?:touch|truncate)(?:\s|$)/i.test(segment)) return true;
      if (/^(?:python|python3|node|ruby)(?:\s|$)/i.test(segment) && /(?:open\(|writeFile(?:Sync)?\(|unlink(?:Sync)?\(|rename(?:Sync)?\()/i.test(segment)) return true;
      if (/^git\s+(?:checkout|restore|reset|clean)(?:\s|$)/i.test(segment)) {
        const objective = ctx.taskObjective ?? "";
        const explicitlyRestoring = /\b(?:descart(?:a|ar|e)?|restaur(?:a|ar|e)?|revert(?:ir|e)?|deshacer|volver\s+a\s+(?:la|una)\s+version|resetear|limpiar\s+cambios)\b/i.test(objective);
        const safeRestore =
          explicitlyRestoring &&
          /^git\s+(?:checkout\s+(?:HEAD\s+)?--|restore\s+(?:--source(?:=|\s+)HEAD\s+)?--)\s+[^;&|]+$/i.test(segment);
        return !safeRestore;
      }
      // Redirecciones de shell que escriben un archivo. `echo`, `cat` y
      // `printf` solos son lectura/diagnóstico y deben seguir permitidos.
      if (/^(?:cat|printf|echo)(?:\s|$)/i.test(segment) && /(?:^|\s)>{1,2}(?:\s|$)/.test(segment)) return true;
      if (/^(?:cat|printf|echo)(?:\s|$)/i.test(segment) && /\d?>{1,2}/.test(segment)) return true;
      return false;
    });
    if (directMutation) {
      return [
        `BLOQUEADO: run_command no puede modificar archivos directamente: "${command}"`,
        "Usa edit_file, apply_patch, write_file o delete_file para mutar archivos del workspace.",
        "Las operaciones de infraestructura permitidas (por ejemplo docker compose up/down/config) sí pueden ejecutarse.",
      ].join("\n");
    }
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
      const exitCode = result.exitCode ?? -1;
      const likelyMutating = /(?:^|[;&|]\s*)(?:sed|perl|python(?:3)?|node|npm|pnpm|yarn|bun|cp|mv|rm|mkdir|rmdir|touch|tee|printf|cat|docker\s+compose\s+(?:up|down|run|build|rm|restart|start|stop)|podman\s+compose\s+(?:up|down|run|build|rm|restart|start|stop))\b/i.test(command);
      const out = [
        `exit code: ${exitCode}`,
        likelyMutating ? `[DSCODE] El comando puede haber modificado archivos o estado del proyecto; se reconciliaron los snapshots después de ejecutarlo.` : "",
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
