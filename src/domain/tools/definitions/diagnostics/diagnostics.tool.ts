import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function detectTsProject(workspaceDir: string): Promise<boolean> {
  return exists(path.join(workspaceDir, "tsconfig.json"));
}

async function detectEslintConfig(workspaceDir: string): Promise<boolean> {
  const candidates = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ];
  for (const c of candidates) if (await exists(path.join(workspaceDir, c))) return true;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(workspaceDir, "package.json"), "utf-8")) as {
      eslintConfig?: unknown;
    };
    return !!pkg.eslintConfig;
  } catch {
    return false;
  }
}

/** Detecta la carpeta de código fuente real del proyecto en vez de asumir "src/". */
async function detectLintTarget(workspaceDir: string): Promise<string> {
  for (const dir of ["src", "app", "lib", "."]) {
    if (dir === ".") return ".";
    if (await exists(path.join(workspaceDir, dir))) return dir;
  }
  return ".";
}

export const diagnosticsTool: ToolDefinition<{ path?: string }> = {
  name: "diagnostics",
  description:
    "Corre diagnósticos estructurados: tsc --noEmit y eslint. Devuelve errores de tipos y lint en formato parseado. Úsalo tras editar para auto-corregir.",
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "diagnostics",
      description:
        "Ejecuta tsc y eslint y devuelve diagnósticos. Opcional path para filtrar a una subcarpeta.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Subcarpeta/archivo a filtrar (relativo). Por defecto todo el proyecto.",
          },
        },
        required: [],
      },
    },
  },
  async execute({ path: relPath }, ctx: ToolContext): Promise<string> {
    const filter = relPath?.trim() || "";
    const parts: string[] = [];

    // tsc — solo si el proyecto realmente es TypeScript (tiene tsconfig.json).
    // Antes se ejecutaba SIEMPRE, incluso en proyectos plain JS/HTML/Python,
    // donde tsc solo produce ruido ("no inputs were found") o falsos "sin
    // errores" que no significan nada para ese proyecto.
    const isTs = await detectTsProject(ctx.workspaceDir);
    if (!isTs) {
      parts.push(
        "[tsc] omitido: no se encontró tsconfig.json en el proyecto (no parece ser TypeScript)"
      );
    } else {
      try {
        const tsc = await execa("npx", ["tsc", "--noEmit", "--pretty", "false"], {
          cwd: ctx.workspaceDir,
          timeout: 30_000,
          reject: false,
        });
        let out = (tsc.stdout + "\n" + tsc.stderr).trim();
        if (filter)
          out = out
            .split("\n")
            .filter((l) => l.includes(filter))
            .join("\n");
        if (!out) parts.push("[tsc] sin errores de tipos");
        else {
          const sliced = out.length > 4000 ? out.slice(0, 4000) + "\n[...tsc truncado...]" : out;
          parts.push(`[tsc]\n${sliced}`);
        }
      } catch (err) {
        parts.push(`[tsc error] ${(err as Error).message}`);
      }
    }

    // eslint json — solo si hay config de eslint, y sobre la carpeta real del
    // proyecto (antes asumía "src/" fijo, que ni existe en muchos proyectos:
    // landings plain HTML, monorepos con "app/", etc. — ahí siempre reportaba
    // "sin errores" de forma engañosa porque nunca encontraba nada que lintear).
    const hasEslintConfig = await detectEslintConfig(ctx.workspaceDir);
    if (!hasEslintConfig) {
      parts.push("[eslint] omitido: no se encontró configuración de eslint en el proyecto");
    } else {
      const lintTarget = await detectLintTarget(ctx.workspaceDir);
      try {
        const lint = await execa("npx", ["eslint", lintTarget, "--format", "json"], {
          cwd: ctx.workspaceDir,
          timeout: 30_000,
          reject: false,
        });
        const lintOut = lint.stdout.trim();
        if (!lintOut) parts.push("[eslint] sin salida");
        else {
          try {
            const json = JSON.parse(lintOut) as Array<{
              filePath: string;
              messages: Array<{
                line: number;
                column: number;
                severity: number;
                message: string;
                ruleId: string | null;
              }>;
            }>;
            const msgs: string[] = [];
            for (const f of json) {
              const rel = f.filePath.replace(ctx.workspaceDir + "/", "");
              if (filter && !rel.includes(filter)) continue;
              for (const m of f.messages) {
                if (m.severity === 0) continue;
                const sev = m.severity === 2 ? "error" : "warn";
                msgs.push(
                  `${rel}:${m.line}:${m.column} ${sev} ${m.message} ${m.ruleId ? `(${m.ruleId})` : ""}`
                );
              }
            }
            if (msgs.length === 0) parts.push("[eslint] sin errores");
            else {
              const joined = msgs.join("\n");
              parts.push(
                `[eslint]\n${joined.length > 4000 ? joined.slice(0, 4000) + "\n[...eslint truncado...]" : joined}`
              );
            }
          } catch {
            const sliced =
              lintOut.length > 4000 ? lintOut.slice(0, 4000) + "\n[...truncado...]" : lintOut;
            parts.push(`[eslint raw]\n${sliced}`);
          }
        }
      } catch (err) {
        parts.push(`[eslint error] ${(err as Error).message}`);
      }
    }

    const combined = parts.join("\n\n");
    return combined.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
      ? combined.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...diagnostics truncado...]"
      : combined;
  },
};
