import { toolRegistry } from "../../domain/tools/index.js";
import { buildSystemPrompt } from "./prompt.js";
import { MAX_TOOL_ITERATIONS } from "./modes.js";
import { APP_CONSTANTS } from "../../shared/constants.js";
import { snapshotFile } from "../../domain/execution/fileSnapshot.js";
import { createLogger } from "../../infrastructure/logger/logger.js";
import { appendTranscript } from "../../infrastructure/transcript/transcript.js";
import { verifyWorkspace } from "../../domain/verification/verifier.js";
import { createTaskState, buildTaskAnchor, type TaskState } from "./taskState.js";
import type { AgentMode } from "./modes.js";

const _log = createLogger("app:agent");

type ToolCall = { id: string; function: { name: string; arguments: string } };
type ChatMessage = { role: string; content?: string | null; tool_calls?: ToolCall[] };
type ChatResponse = { choices?: Array<{ message?: ChatMessage }> };
type ModelClient = {
  chat: { completions: { create: (args: unknown) => Promise<ChatResponse> } };
  close?: () => Promise<void>;
};

interface AgentOpts {
  client: ModelClient;
  workspaceDir: string;
  systemPromptContext: string;
  mode?: AgentMode;
  onEvent?: (e: { type: string; name: string; args?: string; result?: string }) => void;
}

const READ_ONLY_TOOLS = new Set([
  "read_file",
  "read_many_files",
  "list_directory",
  "search_files",
  "glob",
]);
const CONTENT_READ_TOOLS = new Set(["read_file", "read_many_files"]);
const MUTATION_TOOLS = new Set(["write_file", "edit_file", "apply_patch", "delete_file"]);

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max) + "\n[...resultado truncado...]";
}

export class Agent {
  private client: ModelClient;
  private workspaceDir: string;
  private systemPromptContext: string;
  private mode: AgentMode;
  private onEvent: (e: { type: string; name: string; args?: string; result?: string }) => void;
  private messages: Array<Record<string, unknown>> = [];
  private toolLog: ReturnType<typeof createLogger>;
  private task: TaskState | null = null;
  private ioControls: {
    pauseInput?: () => void;
    resumeInput?: () => void;
    pauseSpinner?: () => void;
    resumeSpinner?: (msg?: string) => void;
  } = {};

  constructor(opts: AgentOpts) {
    this.client = opts.client;
    this.workspaceDir = opts.workspaceDir;
    this.systemPromptContext = opts.systemPromptContext;
    this.mode = opts.mode ?? "build";
    this.onEvent = opts.onEvent || (() => {});
    this.toolLog = createLogger("app:agent:tools");
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
  }

  setIOControls(controls: Agent["ioControls"]): void {
    this.ioControls = controls;
  }

  init(): void {
    if (this.messages.some((m) => m.role === "system")) return;
    this.messages.push({
      role: "system",
      content: buildSystemPrompt(this.workspaceDir, this.systemPromptContext),
    });
  }

  private compactHistoryIfNeeded(): void {
    const total = this.messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0);
    if (total < 80_000 || this.messages.length < 12) return;
    const system = this.messages[0]!;
    const keep = this.messages.slice(-10);
    this.messages = [
      system,
      {
        role: "user",
        content:
          "[DSCODE] Historial previo compactado. Usa el estado de tarea y el workspace como fuente de verdad.",
      },
      ...keep,
    ];
  }

  private appendControl(content: string): void {
    this.messages.push({ role: "user", content: `[AGENT CONTROL]\n${content}` });
  }

  private async callModel(allowedSchemas: unknown[]): Promise<ChatMessage> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: "deepseek-chat",
          messages: this.messages,
          tools: allowedSchemas,
        } as never);
        const message = response?.choices?.[0]?.message;
        if (!message) throw new Error("Respuesta inesperada del modelo: falta choices[0].message.");
        return message;
      } catch (err) {
        const msg = (err as Error).message || "";
        const retryable =
          /429|5\d\d|timeout|ECONNRESET|ETIMEDOUT|fetch failed|Target closed|Page closed/i.test(
            msg
          );
        if (!retryable || attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw new Error("No se obtuvo respuesta del modelo.");
  }

  private async markToolResult(
    name: string,
    args: Record<string, unknown>,
    result: string
  ): Promise<void> {
    if (!this.task) return;
    const relPath = typeof args.path === "string" ? args.path.trim() : "";
    if (CONTENT_READ_TOOLS.has(name)) {
      const paths =
        name === "read_many_files" && Array.isArray(args.paths)
          ? args.paths
              .filter((p): p is string => typeof p === "string")
              .map((p) => p.trim())
              .filter(Boolean)
          : relPath
            ? [relPath]
            : [];
      this.task.counters.reads += paths.length || 1;
      for (const inspectedPath of paths) {
        if (!this.task.inspectedFiles.includes(inspectedPath))
          this.task.inspectedFiles.push(inspectedPath);
        const count = (this.task.readCounts[inspectedPath] ?? 0) + 1;
        this.task.readCounts[inspectedPath] = count;
        try {
          const snap = await snapshotFile(this.workspaceDir, inspectedPath);
          this.task.fileSnapshots[inspectedPath] = snap.hash;
          if (snap.exists && this.task.requiresEdit) {
            if (!this.task.targetFiles.includes(inspectedPath))
              this.task.targetFiles.push(inspectedPath);
            this.task.editIntent = {
              path: inspectedPath,
              expectedHash: snap.hash,
              source: "read_snapshot",
            };
          }
        } catch (_e) {
          void _e;
        }
      }
      this.task.lastAction = `read:${name}`;
      if (this.task.requiresEdit && this.task.counters.edits === 0) {
        this.task.phase =
          this.task.editIntent && this.task.counters.reads >= 2 ? "edit" : "inspect";
      }
    } else if (READ_ONLY_TOOLS.has(name)) {
      this.task.lastAction = `inspect:${name}`;
    }
    if (MUTATION_TOOLS.has(name)) {
      this.task.counters.edits++;
      this.task.lastAction = `edit:${name}`;
      if (relPath && !this.task.modifiedFiles.includes(relPath) && /changed=true/i.test(result))
        this.task.modifiedFiles.push(relPath);
      if (relPath && !this.task.targetFiles.includes(relPath)) this.task.targetFiles.push(relPath);
      this.task.editIntent = undefined;
      this.task.phase = /changed=true/i.test(result) ? "verify" : "repair";
      if (
        /Error|FAIL|no se modificó|no encontrado|No existe|aparece \d+ veces|EDIT_CONFLICT/i.test(
          result
        )
      ) {
        this.task.counters.failures++;
        this.task.lastError = truncate(result, 1200);
        this.task.phase = "repair";
      }
    }
  }

  private canRead(pathValue: string): { allowed: boolean; reason?: string } {
    if (!this.task) return { allowed: true };
    const relPath = pathValue.trim();
    const perFile = this.task.readCounts[relPath] ?? 0;
    if (perFile >= APP_CONSTANTS.MAX_READS_PER_FILE) {
      return {
        allowed: false,
        reason: `Presupuesto de lectura agotado para "${relPath}" (${APP_CONSTANTS.MAX_READS_PER_FILE}). Ya existe contexto suficiente: deja de paginar y procede a editar o cambia de estrategia.`,
      };
    }
    if (this.task.counters.reads >= APP_CONSTANTS.MAX_TOTAL_READS) {
      return {
        allowed: false,
        reason: `Presupuesto total de exploración agotado (${APP_CONSTANTS.MAX_TOTAL_READS} lecturas). Debes actuar con la evidencia disponible; no repitas lecturas.`,
      };
    }
    return { allowed: true };
  }

  private async attachEditIntent(name: string, args: Record<string, unknown>): Promise<void> {
    if (!this.task || !MUTATION_TOOLS.has(name)) return;
    const relPath = typeof args.path === "string" ? args.path.trim() : "";
    if (!relPath) return;
    const knownHash = this.task.fileSnapshots[relPath];
    if (knownHash !== undefined) {
      args.expected_hash = knownHash ?? undefined;
      this.task.editIntent = {
        path: relPath,
        expectedHash: knownHash,
        source: knownHash ? "read_snapshot" : "new_file",
      };
      return;
    }
    if (name === "write_file") {
      this.task.editIntent = { path: relPath, expectedHash: null, source: "new_file" };
    }
  }

  private async autoVerify(): Promise<string> {
    if (!this.task || this.task.modifiedFiles.length === 0)
      return "filesystem verification skipped: no confirmed mutations";
    const verificationPaths =
      this.task.lastAction === "edit:delete_file" ? [] : this.task.modifiedFiles;
    const result = await verifyWorkspace(
      this.workspaceDir,
      await Promise.all(
        verificationPaths.map(async (p) => {
          const { snapshotFile } = await import("../../domain/execution/fileSnapshot.js");
          return snapshotFile(this.workspaceDir, p);
        })
      )
    );
    this.task.verification = { passed: result.passed, summary: result.checks.join(" | ") };
    this.task.phase = result.passed ? "complete" : "repair";
    return result.checks.join("\n");
  }

  private shouldReturnText(content: string): boolean {
    if (!this.task || this.mode === "plan") return true;
    if (!this.task.requiresEdit) return true;
    if (this.task.phase === "complete") return true;
    if (
      MUTATION_TOOLS.size > 0 &&
      this.task.counters.edits === 0 &&
      !/tool call|herramienta/i.test(content)
    )
      return false;
    return false;
  }

  async run(userInput: string): Promise<string> {
    if (this.messages.length === 0) this.init();
    this.task = createTaskState(userInput);
    if (this.mode === "plan") this.task.requiresEdit = false;
    this.messages.push({ role: "user", content: userInput });
    appendTranscript(this.workspaceDir, { role: "user", content: userInput, taskId: this.task.id });

    const allowedSchemas =
      this.mode === "plan" ? toolRegistry.getSchemasForMode("plan") : toolRegistry.getSchemas();
    let finalContent = "";
    let lastCallKey = "";
    let repeatedCalls = 0;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      this.task.counters.iterations = i + 1;
      this.compactHistoryIfNeeded();
      this.messages.push({ role: "user", content: buildTaskAnchor(this.task, this.workspaceDir) });
      const msg = await this.callModel(allowedSchemas);
      const calls = msg.tool_calls ?? [];

      if (calls.length === 0) {
        const content = String(msg.content ?? "");
        this.messages.push({ role: "assistant", content });
        appendTranscript(this.workspaceDir, {
          role: "assistant",
          content,
          taskId: this.task.id,
          turn: i,
        });
        finalContent = content;

        if (this.shouldReturnText(content)) return content;
        this.appendControl(
          [
            "La tarea sigue incompleta.",
            `phase=${this.task.phase}`,
            `requires_edit=${this.task.requiresEdit}`,
            `modified_files=${this.task.modifiedFiles.join(", ") || "none"}`,
            "No des una explicación todavía. Ejecuta el siguiente tool call necesario. Si ya falta solo editar, usa una única herramienta de mutación.",
          ].join("\n")
        );
        continue;
      }

      const call = calls[0]!; // Un solo tool call por turno es parte del protocolo v3.
      const key = `${call.function.name}:${call.function.arguments}`;
      if (key === lastCallKey) repeatedCalls++;
      else repeatedCalls = 1;
      lastCallKey = key;
      if (repeatedCalls >= 3) {
        this.task.lastError = `Loop detectado: ${call.function.name}`;
        this.task.counters.failures++;
        this.appendControl(
          "El mismo tool call se repitió tres veces. Cambia de estrategia y utiliza otra evidencia o herramienta."
        );
        repeatedCalls = 0;
        continue;
      }

      this.messages.push({ role: "assistant", content: null, tool_calls: [call] });
      const { name } = call.function;
      const tool = toolRegistry.get(name);
      let args: Record<string, unknown> = {};
      let result = "";
      try {
        args = JSON.parse(call.function.arguments || "{}");
        let blockedByBudget = false;
        if (CONTENT_READ_TOOLS.has(name)) {
          const paths =
            name === "read_many_files" && Array.isArray(args.paths)
              ? args.paths
                  .filter((p): p is string => typeof p === "string")
                  .map((p) => p.trim())
                  .filter(Boolean)
              : typeof args.path === "string"
                ? [args.path]
                : [];
          if (this.task.counters.reads + paths.length > APP_CONSTANTS.MAX_TOTAL_READS) {
            result = `EXPLORATION_BUDGET: el batch requeriría ${paths.length} lecturas adicionales y superaría el máximo de ${APP_CONSTANTS.MAX_TOTAL_READS}. Divide el batch y prioriza los archivos necesarios para editar.`;
            this.task.lastError = result;
            this.task.phase = "edit";
            blockedByBudget = true;
          } else {
            for (const readPath of paths) {
              const budget = this.canRead(readPath);
              if (!budget.allowed) {
                result = `EXPLORATION_BUDGET: ${budget.reason}`;
                this.task.lastError = result;
                this.task.phase = "edit";
                blockedByBudget = true;
                break;
              }
            }
          }
        }
        if (!blockedByBudget) {
          await this.attachEditIntent(name, args);
          this.onEvent({ type: "tool_call", name, args: JSON.stringify(args) });
          this.toolLog.debug({ tool: name, args }, "tool_call");
          if (!tool) throw new Error(`Tool desconocida: ${name}`);
          if (this.mode === "plan" && !tool.readOnly)
            throw new Error(`Tool ${name} no permitida en PLAN.`);
          result = await tool.execute(args, {
            workspaceDir: this.workspaceDir,
            mode: this.mode,
            logger: this.toolLog,
            pauseInput: this.ioControls.pauseInput,
            resumeInput: this.ioControls.resumeInput,
            pauseSpinner: this.ioControls.pauseSpinner,
            resumeSpinner: this.ioControls.resumeSpinner,
          });
        }
      } catch (err) {
        result = `Error ejecutando ${name}: ${(err as Error).message}`;
      }

      const safeResult = truncate(result, APP_CONSTANTS.MAX_TOOL_RESULT_CHARS);
      if (!safeResult.startsWith("EXPLORATION_BUDGET:")) {
        await this.markToolResult(name, args, safeResult);
      }
      this.onEvent({ type: "tool_result", name, result: safeResult });
      if (
        CONTENT_READ_TOOLS.has(name) &&
        this.task.requiresEdit &&
        this.task.counters.reads >= 1 &&
        this.task.targetFiles.length > 0
      ) {
        this.task.phase =
          this.task.counters.reads >= APP_CONSTANTS.MAX_TOTAL_READS ? "edit" : this.task.phase;
      }
      this.toolLog.debug({ tool: name, resultPreview: safeResult.slice(0, 500) }, "tool_result");
      this.messages.push({ role: "tool", tool_call_id: call.id, name, content: safeResult });

      if (MUTATION_TOOLS.has(name)) {
        const changed = /changed=true/i.test(safeResult);
        if (changed) {
          const verification = await this.autoVerify();
          const control =
            this.task.phase === "complete"
              ? `La edición física fue confirmada y la verificación terminó correctamente.\n${verification}\nLa tarea está completa: responde ahora con un resumen breve. No hagas más cambios salvo que el usuario los pida.`
              : `La edición física ocurrió, pero la verificación falló.\n${verification}\nAnaliza el error y genera el próximo tool call de reparación.`;
          this.appendControl(control);
        } else {
          this.appendControl(
            "La herramienta de mutación no confirmó changed=true. La tarea NO está cumplida. Lee o ajusta el patch y vuelve a intentar una mutación distinta."
          );
        }
      }
    }

    const statusText = this.task?.verification
      ? this.task.verification.passed
        ? "verificado"
        : "requiere reparación"
      : this.task?.phase === "repair"
        ? "requiere reparación"
        : undefined;
    const errorText = this.task?.lastError ? `\nÚltimo error: ${this.task.lastError}` : "";
    const suffix = statusText
      ? `\n\nEstado: ${statusText}.${errorText}`
      : errorText
        ? `\n\n${errorText}`
        : "";
    return (
      finalContent ||
      `No se completó la tarea dentro de ${MAX_TOOL_ITERATIONS} iteraciones.${suffix}`
    );
  }

  async close(): Promise<void> {
    if (typeof this.client.close === "function") await this.client.close();
  }
}
