import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { TaskState } from "../../app/agent/taskState.js";

export interface TaskEvent {
  id: string;
  ts: string;
  type: string;
  taskId: string;
  data?: Record<string, unknown>;
}

export interface PersistedTurn {
  turnId: string;
  taskId: string;
  request: string;
  requestHash: string;
  status: string;
  attempts: Array<{
    id: string;
    status: string;
    error?: string;
    chatId?: string;
    requestHash: string;
  }>;
  response?: string;
  error?: string;
}

function workspaceRoot(workspaceDir: string): string {
  const base = process.env.DSCODE_TASK_DIR || path.join(os.homedir(), ".dscode", "tasks");
  const safe = `${path.basename(path.resolve(workspaceDir))}-${Buffer.from(path.resolve(workspaceDir)).toString("hex").slice(0, 12)}`;
  return path.join(base, safe);
}

export class TaskPersistence {
  private readonly root: string;
  private eventSeq = 0;
  constructor(workspaceDir: string) {
    this.root = workspaceRoot(workspaceDir);
  }
  private taskDir(taskId: string): string {
    return path.join(this.root, taskId);
  }
  async init(taskId?: string): Promise<void> {
    const dir = taskId ? this.taskDir(taskId) : this.root;
    await fs.mkdir(path.join(dir, "turns"), { recursive: true });
    await fs.mkdir(path.join(dir, "attempts"), { recursive: true });
    await fs.mkdir(path.join(dir, "artifacts"), { recursive: true });
  }
  async saveState(state: TaskState): Promise<void> {
    await this.init(state.id);
    await atomicWrite(
      path.join(this.taskDir(state.id), "state.json"),
      JSON.stringify(state, null, 2)
    );
  }
  async saveMetadata(taskId: string, data: Record<string, unknown>): Promise<void> {
    await this.init(taskId);
    await atomicWrite(
      path.join(this.taskDir(taskId), "metadata.json"),
      JSON.stringify(data, null, 2)
    );
  }
  async appendEvent(type: string, taskId: string, data?: Record<string, unknown>): Promise<void> {
    await this.init(taskId);
    const event: TaskEvent = {
      id: `${Date.now()}_${++this.eventSeq}`,
      ts: new Date().toISOString(),
      type,
      taskId,
      data,
    };
    await fs.appendFile(
      path.join(this.taskDir(taskId), "events.jsonl"),
      JSON.stringify(event) + "\n",
      "utf8"
    );
  }
  async saveTurn(turn: PersistedTurn): Promise<void> {
    await this.init(turn.taskId);
    await atomicWrite(
      path.join(this.taskDir(turn.taskId), "turns", `${turn.turnId}.json`),
      JSON.stringify(turn, null, 2)
    );
  }
  get directory(): string {
    return this.root;
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}
