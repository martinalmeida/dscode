import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../shared/safePath.js";
import { snapshotFile, type FileSnapshot } from "./fileSnapshot.js";

export class EditConflictError extends Error {
  constructor(
    public readonly relativePath: string,
    public readonly expectedHash: string | null,
    public readonly actualHash: string | null
  ) {
    super(
      `EDIT_CONFLICT ${relativePath}: el archivo cambió desde la última lectura (expected=${expectedHash ?? "<missing>"}, actual=${actualHash ?? "<missing>"}). Vuelve a leer el archivo antes de editar.`
    );
    this.name = "EditConflictError";
  }
}

export interface EditTransactionResult {
  path: string;
  changed: boolean;
  before: FileSnapshot;
  after: FileSnapshot;
}

export async function writeFileTransaction(
  workspaceDir: string,
  relativePath: string,
  content: string,
  expectedHash?: string | null
): Promise<EditTransactionResult> {
  const absolutePath = resolveSafe(workspaceDir, relativePath);
  const before = await snapshotFile(workspaceDir, relativePath);
  if (expectedHash !== undefined && before.hash !== expectedHash)
    throw new EditConflictError(relativePath, expectedHash, before.hash);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.dscode-${process.pid}-${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, absolutePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
  const after = await snapshotFile(workspaceDir, relativePath);
  return { path: relativePath, changed: before.hash !== after.hash, before, after };
}

export async function deleteFileTransaction(
  workspaceDir: string,
  relativePath: string,
  expectedHash?: string | null
): Promise<EditTransactionResult> {
  const absolutePath = resolveSafe(workspaceDir, relativePath);
  const before = await snapshotFile(workspaceDir, relativePath);
  if (expectedHash !== undefined && before.hash !== expectedHash)
    throw new EditConflictError(relativePath, expectedHash, before.hash);
  if (before.exists) await fs.rm(absolutePath, { force: true });
  const after = await snapshotFile(workspaceDir, relativePath);
  return { path: relativePath, changed: before.hash !== after.hash, before, after };
}

export function formatEditTransaction(result: EditTransactionResult): string {
  return [
    `EDIT_RESULT path=${result.path}`,
    `changed=${result.changed}`,
    `before_hash=${result.before.hash ?? "<missing>"}`,
    `after_hash=${result.after.hash ?? "<missing>"}`,
    `before_bytes=${result.before.bytes}`,
    `after_bytes=${result.after.bytes}`,
    `before_lines=${result.before.lineCount}`,
    `after_lines=${result.after.lineCount}`,
  ].join("\n");
}
