import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { resolveSafe } from "../../shared/safePath.js";

export interface FileSnapshot {
  path: string;
  absolutePath: string;
  exists: boolean;
  bytes: number;
  hash: string | null;
  lineCount: number;
}

export async function snapshotFile(
  workspaceDir: string,
  relativePath: string
): Promise<FileSnapshot> {
  const absolutePath = resolveSafe(workspaceDir, relativePath);
  try {
    const content = await fs.readFile(absolutePath);
    const text = content.toString("utf8");
    return {
      path: path.relative(workspaceDir, absolutePath) || path.basename(absolutePath),
      absolutePath,
      exists: true,
      bytes: content.byteLength,
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      lineCount: text.length === 0 ? 0 : text.split(/\r?\n/).length,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        path: relativePath,
        absolutePath,
        exists: false,
        bytes: 0,
        hash: null,
        lineCount: 0,
      };
    }
    throw error;
  }
}

export async function readTextSnapshot(
  workspaceDir: string,
  relativePath: string
): Promise<{ content: string; snapshot: FileSnapshot }> {
  const absolutePath = resolveSafe(workspaceDir, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  return { content, snapshot: await snapshotFile(workspaceDir, relativePath) };
}
