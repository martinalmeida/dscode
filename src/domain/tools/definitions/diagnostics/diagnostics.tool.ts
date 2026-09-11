import { execa } from "execa";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

export const diagnosticsTool: ToolDefinition<{ path?: string }> = {
  name: "diagnostics",
  description:
    "Corre diagnósticos estructurados: tsc --noEmit y eslint. Devuelve errores de tipos y lint en formato parseado. Úsalo tras editar para auto-corregir.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "diagnostics",
      description: "Ejecuta tsc y eslint y devuelve diagnósticos. Opcional path para filtrar a una subcarpeta.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Subcarpeta/archivo a filtrar (relativo). Por defecto todo el proyecto." },
        },
        required: [],
      },
    },
  },
  async execute({ path: relPath }, ctx: ToolContext): Promise<string> {
    const filter = relPath?.trim() || "";
    const parts: string[] = [];

    // tsc
    try {
      const tsc = await execa("npx", ["tsc", "--noEmit", "--pretty", "false"], {
        cwd: ctx.workspaceDir,
        timeout: 30_000,
        reject: false,
      });
      let out = (tsc.stdout + "\n" + tsc.stderr).trim();
      if (filter) out = out.split("\n").filter((l) => l.includes(filter)).join("\n");
      if (!out) parts.push("[tsc] sin errores de tipos");
      else {
        const sliced = out.length > 4000 ? out.slice(0, 4000) + "\n[...tsc truncado...]" : out;
        parts.push(`[tsc]\n${sliced}`);
      }
    } catch (err) {
      parts.push(`[tsc error] ${(err as Error).message}`);
    }

    // eslint json
    try {
      const lint = await execa("npx", ["eslint", "src/", "--format", "json"], {
        cwd: ctx.workspaceDir,
        timeout: 30_000,
        reject: false,
      });
      let lintOut = lint.stdout.trim();
      if (!lintOut) parts.push("[eslint] sin salida");
      else {
        try {
          const json = JSON.parse(lintOut) as Array<{ filePath: string; messages: Array<{ line: number; column: number; severity: number; message: string; ruleId: string | null }> }>;
          const msgs: string[] = [];
          for (const f of json) {
            const rel = f.filePath.replace(ctx.workspaceDir + "/", "");
            if (filter && !rel.includes(filter)) continue;
            for (const m of f.messages) {
              if (m.severity === 0) continue;
              const sev = m.severity === 2 ? "error" : "warn";
              msgs.push(`${rel}:${m.line}:${m.column} ${sev} ${m.message} ${m.ruleId ? `(${m.ruleId})` : ""}`);
            }
          }
          if (msgs.length === 0) parts.push("[eslint] sin errores");
          else {
            const joined = msgs.join("\n");
            parts.push(`[eslint]\n${joined.length > 4000 ? joined.slice(0, 4000) + "\n[...eslint truncado...]" : joined}`);
          }
        } catch {
          const sliced = lintOut.length > 4000 ? lintOut.slice(0, 4000) + "\n[...truncado...]" : lintOut;
          parts.push(`[eslint raw]\n${sliced}`);
        }
      }
    } catch (err) {
      parts.push(`[eslint error] ${(err as Error).message}`);
    }

    const combined = parts.join("\n\n");
    return combined.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
      ? combined.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...diagnostics truncado...]"
      : combined;
  },
};
