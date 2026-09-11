import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import { APP_CONSTANTS } from "../../../../shared/constants.js";
import {
  writeFileTransaction,
  formatEditTransaction,
  EditConflictError,
} from "../../../execution/editTransaction.js";
import { snapshotFile } from "../../../execution/fileSnapshot.js";

type PatchArgs = { path: string; diff: string; dryRun?: boolean; expected_hash?: string };

function applyUnifiedDiff(original: string, diff: string): string | null {
  const usesCRLF = original.includes("\r\n");
  const origLines = original.replace(/\r\n/g, "\n").split("\n");
  const diffLines = diff.replace(/\r\n/g, "\n").split("\n");

  // First try the strict unified-diff path. This preserves the original behavior
  // for normal hunks such as @@ -120,4 +120,5 @@.
  const strictResult = applyStrictUnifiedDiff(origLines, diffLines);
  if (strictResult !== null) {
    const joined = strictResult.join("\n");
    return usesCRLF ? joined.replace(/\n/g, "\r\n") : joined;
  }

  // DeepSeek sometimes emits a compact hunk as just "@@" followed by exact
  // deletion/addition lines. Accept that form too, locating the deleted block
  // automatically. This keeps the tool resilient to model-generated patches.
  const hunks = splitBareHunks(diffLines);
  if (hunks.length === 0) return null;

  const working = [...origLines];
  for (const hunk of hunks) {
    const oldLines = hunk.filter((line) => line.startsWith("-")).map((line) => line.slice(1));
    const newLines = hunk.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
    if (oldLines.length === 0) return null;

    const matches: number[] = [];
    outer: for (let start = 0; start <= working.length - oldLines.length; start++) {
      for (let j = 0; j < oldLines.length; j++) {
        if (working[start + j] !== oldLines[j]) continue outer;
      }
      matches.push(start);
      if (matches.length > 1) break;
    }
    if (matches.length !== 1) return null;
    const at = matches[0]!;
    working.splice(at, oldLines.length, ...newLines);
  }

  const joined = working.join("\n");
  return usesCRLF ? joined.replace(/\n/g, "\r\n") : joined;
}

function applyStrictUnifiedDiff(origLines: string[], diffLines: string[]): string[] | null {
  const result: string[] = [];
  let origIdx = 0;
  let i = 0;
  while (
    i < diffLines.length &&
    (diffLines[i]!.startsWith("---") || diffLines[i]!.startsWith("+++"))
  )
    i++;
  let foundHunk = false;

  while (i < diffLines.length) {
    const line = diffLines[i]!;
    if (!line.startsWith("@@")) {
      i++;
      continue;
    }
    const m = line.match(/@@\s*-(\d+),?(\d*)\s*\+(\d+),?(\d*)\s*@@/);
    if (!m) return foundHunk ? null : null;
    foundHunk = true;
    const oldStart = parseInt(m[1]!, 10) - 1;
    if (oldStart < origIdx || oldStart > origLines.length) return null;
    while (origIdx < oldStart) {
      result.push(origLines[origIdx] ?? "");
      origIdx++;
    }
    i++;
    while (i < diffLines.length && !diffLines[i]!.startsWith("@@")) {
      const dl = diffLines[i]!;
      if (dl.startsWith(" ")) {
        if (origLines[origIdx] !== dl.slice(1)) return null;
        result.push(dl.slice(1));
        origIdx++;
      } else if (dl.startsWith("-")) {
        if (origLines[origIdx] !== dl.slice(1)) return null;
        origIdx++;
      } else if (dl.startsWith("+")) {
        result.push(dl.slice(1));
      } else if (dl === "" || dl === "\\ No newline at end of file") {
        // ignore metadata/empty trailing line
      } else {
        return null;
      }
      i++;
    }
  }
  if (!foundHunk) return null;
  while (origIdx < origLines.length) {
    result.push(origLines[origIdx]!);
    origIdx++;
  }
  return result;
}

function splitBareHunks(diffLines: string[]): string[][] {
  const hunks: string[][] = [];
  let current: string[] | null = null;
  for (const line of diffLines) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("@@")) {
      if (current && current.length > 0) hunks.push(current);
      current = [];
      continue;
    }
    if (current && (line.startsWith("-") || line.startsWith("+"))) current.push(line);
  }
  if (current && current.length > 0) hunks.push(current);
  return hunks;
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
        "Aplica un unified diff a un archivo. Acepta headers estándar @@ -10,2 +10,3 @@ o el formato compacto @@ seguido de líneas -/+ exactas. dryRun=true solo previsualiza.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Ruta relativa al workspace del archivo a parchear.",
          },
          expected_hash: {
            type: "string",
            description:
              "Hash SHA-256 de la última lectura conocida; evita parchear una versión obsoleta.",
          },
          diff: {
            type: "string",
            description: 'Unified diff con headers @@. Ej: "@@ -1,3 +1,3 @@\\n-foo\\n+bar"',
          },
          dryRun: {
            type: "boolean",
            description: "Si true, no escribe; solo valida y previsualiza.",
          },
        },
        required: ["path", "diff"],
      },
    },
  },
  async execute({ path: relPath, diff, dryRun, expected_hash }, ctx: ToolContext): Promise<string> {
    if (!relPath || !relPath.trim()) return 'Error: falta "path".';
    if (!diff || !diff.trim()) return 'Error: falta "diff" (unified diff).';
    const full = resolveSafe(ctx.workspaceDir, relPath.trim());
    if (full === path.resolve(ctx.workspaceDir)) return "Error: no se puede parchear la raíz.";
    if (expected_hash !== undefined) {
      const current = await snapshotFile(ctx.workspaceDir, relPath.trim());
      if (current.hash !== expected_hash) {
        throw new EditConflictError(relPath.trim(), expected_hash, current.hash);
      }
    }
    let original = "";
    try {
      original = await fs.readFile(full, "utf-8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT")
        return `No existe: "${relPath}" — nada que parchear. Crea el archivo con write_file primero.`;
      return `Error leyendo "${relPath}": ${(e as Error).message}`;
    }
    const patched = applyUnifiedDiff(original, diff);
    if (patched === null)
      return `Error: el diff no aplica limpio sobre "${relPath}" (contexto no coincide). Revisa @@ y líneas contextuales. No se modificó el archivo.`;
    const preview = buildPreview(original, patched);
    if (dryRun) return `[dryRun OK] ${relPath}: ${preview}\nDiff validado, no se escribió.`;
    const transaction = await writeFileTransaction(
      ctx.workspaceDir,
      relPath.trim(),
      patched,
      expected_hash
    );
    const truncated =
      patched.length > APP_CONSTANTS.MAX_TOOL_RESULT_CHARS
        ? patched.slice(0, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS) + "\n[...truncado...]"
        : null;
    if (truncated)
      return `Patch aplicado: ${relPath} (${preview})\n${formatEditTransaction(transaction)}\n[contenido truncado]\n${truncated}`;
    return `Patch aplicado: ${relPath} (${preview})\n${formatEditTransaction(transaction)}`;
  },
};
