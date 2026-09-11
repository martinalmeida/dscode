import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createLogger } from "../logger/logger.js";

const log = createLogger("transcript");

function transcriptDir(workspaceDir: string): string {
  const hash = crypto.createHash("sha1").update(path.resolve(workspaceDir)).digest("hex").slice(0, 8);
  const base = process.env.DSCODE_TRANSCRIPT_DIR || path.join(os.homedir(), ".cache", "dscode", "transcripts");
  return path.join(base, `${path.basename(path.resolve(workspaceDir))}-${hash}`);
}

function transcriptPath(workspaceDir: string): string {
  return path.join(transcriptDir(workspaceDir), `${new Date().toISOString().slice(0, 10)}.jsonl`);
}

export function appendTranscript(workspaceDir: string, entry: Record<string, unknown>): void {
  try {
    const dir = transcriptDir(workspaceDir);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(transcriptPath(workspaceDir), line + "\n", "utf-8");
  } catch (e) {
    log.warn({ err: e }, "transcript append failed");
  }
}
