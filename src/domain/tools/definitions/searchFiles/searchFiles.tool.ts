import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

async function findByFilename(
  base: string,
  needle: string,
  workspaceDir: string,
  maxResults = 20
): Promise<string[]> {
  const normalized = needle.toLowerCase().replace(/[^a-z0-9._/-]/g, "");
  if (!normalized) return [];
  const stem = normalized.split("/").pop() ?? normalized;
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (_e) {
      void _e;
      return;
    }
    for (const e of entries) {
      if (APP_CONSTANTS.IGNORED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(workspaceDir, full);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().includes(stem)) {
        results.push(rel);
        if (results.length >= maxResults) return;
      }
    }
  }
  await walk(base);
  return results;
}

export const searchFilesTool: ToolDefinition<{ pattern: string; path?: string }> = {
  name: "search_files",
  description:
    'Busca texto/regex dentro de archivos (grep) Y por nombre de archivo. No necesitas la extensión: buscar "xddvd" encuentra "xddvd.md", "xddvd.txt", etc. Ideal para localizar archivos antes de leer/borrar.',
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "search_files",
      description:
        'Busca texto/regex dentro de archivos (grep) Y por nombre de archivo. No necesitas la extensión: buscar "xddvd" encuentra "xddvd.md".',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              'Texto o regex a buscar. Sin extensión también matchea nombres de archivo: "xddvd" encuentra "xddvd.md".',
          },
          path: {
            type: "string",
            description:
              "Carpeta donde buscar, relativa al workspace. Por defecto '.' (todo el proyecto).",
          },
        },
        required: ["pattern"],
      },
    },
  },
  async execute({ pattern, path: relPath = "." }, ctx: ToolContext): Promise<string> {
    const full = resolveSafe(ctx.workspaceDir, relPath);
    let grepOut = "";
    let grepErr = "";
    try {
      const result = await execa(
        "grep",
        [
          "-rEn",
          "--exclude-dir=node_modules",
          "--exclude-dir=.git",
          "--exclude-dir=vendor",
          "--exclude-dir=__pycache__",
          "--exclude-dir=.venv",
          "--exclude-dir=.bundle",
          "--exclude-dir=dist",
          "--exclude-dir=build",
          "--exclude-dir=.next",
          "--exclude-dir=.cache",
          "--",
          pattern,
          full,
        ],
        { reject: false, timeout: APP_CONSTANTS.SEARCH_TIMEOUT_MS }
      );
      if (result.exitCode === 2) grepErr = result.stderr || "grep código 2";
      else grepOut = result.stdout;
    } catch (err) {
      grepErr = (err as Error).message;
    }

    // Búsqueda por nombre de archivo (fuzzy sin extensión)
    let nameMatches: string[] = [];
    try {
      nameMatches = await findByFilename(full, pattern, ctx.workspaceDir);
    } catch (_e) {
      void _e;
    }

    const parts: string[] = [];
    if (grepOut) {
      const truncated =
        grepOut.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
          ? grepOut.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...grep truncado...]"
          : grepOut;
      parts.push(`[Coincidencias por contenido grep]\n${truncated}`);
    } else if (grepErr) parts.push(`[grep error: ${grepErr}]`);
    else parts.push("[Coincidencias por contenido grep]\n(sin coincidencias)");

    if (nameMatches.length > 0)
      parts.push(
        `[Coincidencias por nombre de archivo — no necesitas extensión]\n${nameMatches.join("\n")}`
      );
    else parts.push("[Coincidencias por nombre de archivo]\n(sin coincidencias)");

    const combined = parts.join("\n\n");
    if (!grepOut && nameMatches.length === 0)
      return "(sin coincidencias por contenido ni por nombre)";
    return combined.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
      ? combined.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...resultados truncados...]"
      : combined;
  },
};
