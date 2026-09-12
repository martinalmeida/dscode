import fs from "node:fs/promises";
import path from "node:path";

export interface DomDiffResult {
  before: string;
  after: string;
  addedLines: number;
  removedLines: number;
  changedLines: number;
  summary: string;
}

export async function compareDomFiles(
  beforeFile: string,
  afterFile: string
): Promise<DomDiffResult> {
  const [before, after] = await Promise.all([
    fs.readFile(beforeFile, "utf8"),
    fs.readFile(afterFile, "utf8"),
  ]);
  const result = diffLines(before.split(/\r?\n/), after.split(/\r?\n/));
  return {
    before: path.resolve(beforeFile),
    after: path.resolve(afterFile),
    addedLines: result.added,
    removedLines: result.removed,
    changedLines: Math.min(result.added, result.removed),
    summary: `+${result.added} / -${result.removed} líneas; ${Math.min(result.added, result.removed)} cambios aproximados.`,
  };
}

function diffLines(before: string[], after: string[]): { added: number; removed: number } {
  const n = before.length;
  const m = after.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        before[i] === after[j]
          ? (dp[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      removed++;
      i++;
    } else {
      added++;
      j++;
    }
  }
  removed += n - i;
  added += m - j;
  return { added, removed };
}
