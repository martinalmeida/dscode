import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";

type PatchArgs = { path: string; diff: string; dryRun?: boolean };

function applyUnifiedDiff(original: string, diff: string): string | null {
  const origLines = original.split("\n");
  const diffLines = diff.split("\n");
  const result: string[] = [];
  let origIdx = 0;
  let i = 0;
  // Saltar headers ---/+++
  while (i < diffLines.length && (diffLines[i]!.startsWith("---") || diffLines[i]!.startsWith("+++"))) i++;
  while (i < diffLines.length) {
    const line = diffLines[i]!;
    if (line.startsWith("@@")) {
      const m = line.match(/@@\s*-(\d+),?(\d*)\s*\+(\d+),?(\d*)\s*@@/);
      if (!m) return null;
      const oldStart = parseInt(m[1]!, 10) - 1;
      // copiar líneas sin cambios hasta hunk
      while (origIdx < oldStart) {
        result.push(origLines[origIdx] ?? "");
        origIdx++;
      }
      i++;
      while (i < diffLines.length && !diffLines[i]!.startsWith("@@")) {
        const dl = diffLines[i]!;
        if (dl.startsWith(" ")) {
          result.push(dl.slice(1));
          origIdx++;
        } else if (dl.startsWith("-")) {
          // verificar que coincide
          if (origLines[origIdx] !== dl.slice(1)) return null;
          origIdx++;
        } else if (dl.startsWith("+")) {
          result.push(dl.slice(1));
        } else if (dl === "" || dl === "\\ No newline at end of file") {
          // ignorar
        } else {
          // línea inesperada
          return null;
        }
        i++;
      }
    } else {
      i++;
    }
  }
  while (origIdx < origLines.length) {
    result.push(origLines[origIdx]!);
    origIdx++;
  }
  return result.join("\n");
}

function buildPreview(oldContent: string, newContent: string): string {
  const o = oldContent.split("\n").length;
  const n = newContent.split("\n").length;
  return `Antes: ${o} líneas / Después: ${n} líneas`;
}

export const patchTool: ToolDefinition<PatchArgs> = {
  name: "apply_patch",
  description:
    "Aplica un patch unified diff (multi-hunk) de forma atómica a un archivo. Útil para refactors que tocan varias zonas del mismo fichero. Soporta dryRun para previsualizar. Si el diff no aplica limpio, no toca el disco.",
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Aplica un unified diff a un archivo. Requiere path y diff (formato @@ ... @@). dryRun=true solo previsualiza.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta relativa al workspace del archivo a parchear." },
          diff: { type: "string", description: "Unified diff con headers @@. Ej: \"@@ -1,3 +1,3 @@\\n-foo\\n+bar\"" },
          dryRun: { type: "boolean", description: "Si true, no escribe; solo valida y previsualiza." },
        },
        required: ["path", "diff"],
      },
    },
  },
  async execute({ path: relPath, diff, dryRun }, ctx: ToolContext): Promise<string> {
    if (!relPath || !relPath.trim()) return 'Error: falta "path".';
    if (!diff || !diff.trim()) return 'Error: falta "diff" (unified diff).';
    const full = resolveSafe(ctx.workspaceDir, relPath.trim());
    if (full === path.resolve(ctx.workspaceDir)) return "Error: no se puede parchear la raíz.";
    let original = "";
    try {
      original = await fs.readFile(full, "utf-8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return `No existe: "${relPath}" — nada que parchear. Crea el archivo con write_file primero.`;
      return `Error leyendo "${relPath}": ${(e as Error).message}`;
    }
    const patched = applyUnifiedDiff(original, diff);
    if (patched === null)
      return `Error: el diff no aplica limpio sobre "${relPath}" (contexto no coincide). Revisa @@ y líneas contextuales. No se modificó el archivo.`;
    const preview = buildPreview(original, patched);
    if (dryRun) return `[dryRun OK] ${relPath}: ${preview}\nDiff validado, no se escribió.`;
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, patched, "utf-8");
    const truncated =
      patched.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
        ? patched.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...truncado...]"
        : null;
    if (truncated) return `Patch aplicado: ${relPath} (${preview})\n[contenido truncado]\n${truncated}`;
    return `Patch aplicado: ${relPath} (${preview})`;
  },
};
