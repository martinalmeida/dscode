import { toolRegistry } from "../../domain/tools/index.js";
import { buildSystemPrompt } from "./prompt.js";
import { MAX_TOOL_ITERATIONS } from "./modes.js";
import { APP_CONSTANTS } from "../../shared/constants.js";
import { createLogger } from "../../infrastructure/logger/logger.js";
import { appendTranscript } from "../../infrastructure/transcript/transcript.js";
import type { AgentMode } from "./modes.js";

const log = createLogger("app:agent");

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

export class Agent {
  private client: ModelClient;
  private workspaceDir: string;
  private systemPromptContext: string;
  private mode: AgentMode;
  private onEvent: (e: { type: string; name: string; args?: string; result?: string }) => void;
  private messages: Array<Record<string, unknown>> = [];
  private toolLog: ReturnType<typeof createLogger>;
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
    log.debug({ mode }, "Modo cambiado");
    this.mode = mode;
  }

  setIOControls(controls: {
    pauseInput?: () => void;
    resumeInput?: () => void;
    pauseSpinner?: () => void;
    resumeSpinner?: (msg?: string) => void;
  }): void {
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
    // Compaction para trabajo pesado: evita desbordar context-window (≈100k chars)
    const MAX_HISTORY_CHARS = 100_000;
    const total = this.messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0);
    if (total < MAX_HISTORY_CHARS || this.messages.length < 10) return;
    // Mantener system + últimos 8 mensajes, resumir el resto
    const sys = this.messages[0]!;
    const keep = this.messages.slice(-8);
    const dropped = this.messages.length - 1 - keep.length;
    const summary = { role: "tool", tool_call_id: "compact", name: "system", content: `[Historial compactado: se omitieron ${dropped} mensajes antiguos para trabajo pesado. Últimos ${keep.length} mensajes preservados. Si necesitas contexto previo, usa search_files/glob.]` };
    this.messages = [sys, summary as unknown as Record<string, unknown>, ...keep];
    log.warn({ dropped, total }, "Historial compactado por peso");
  }

  private async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit = 4): Promise<T[]> {
    const results: T[] = new Array(tasks.length) as T[];
    let idx = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (idx < tasks.length) {
        const cur = idx++;
        results[cur] = await tasks[cur]!();
      }
    });
    await Promise.all(workers);
    return results;
  }

  async run(userInput: string): Promise<string> {
    if (this.messages.length === 0) this.init();
    this.messages.push({ role: "user", content: userInput });
    appendTranscript(this.workspaceDir, { role: "user", content: userInput });
    const allSchemas = toolRegistry.getSchemas();
    const allowedSchemas =
      this.mode === "plan" ? toolRegistry.getSchemasForMode("plan") : allSchemas;
    log.debug({ mode: this.mode, toolCount: allowedSchemas.length }, "run iniciado");

    const recentCalls: string[] = [];
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      this.compactHistoryIfNeeded();
      let response: ChatResponse | undefined;
      // Retry con backoff simple para transient errors (429, 5xx, timeout, ECONNRESET)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = (await this.client.chat.completions.create({
            model: "deepseek-chat",
            messages: this.messages,
            tools: allowedSchemas,
          } as never)) as ChatResponse;
          break;
        } catch (err) {
          const msg = (err as Error).message || "";
          const retryable = /429|5\d\d|timeout|ECONNRESET|ETIMEDOUT|fetch failed|Target closed|Page closed/i.test(msg);
          if (!retryable || attempt === 2) throw err;
          const delay = 500 * 2 ** attempt + Math.random() * 200;
          log.warn({ attempt, delay: Math.round(delay), err: msg }, "Reintentando LLM call");
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      if (!response) throw new Error("No se obtuvo respuesta del modelo tras reintentos");
      const resp = response;
      const choice = resp?.choices?.[0];
      if (!choice?.message) {
        throw new Error(
          "Respuesta inesperada del modelo: no vino 'choices[0].message'. Revisa la consola por errores de Playwright (sesión expirada, Cloudflare, Chromium)."
        );
      }
      const msg = choice.message;
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const content = (msg.content as string | null) ?? "";
        this.messages.push({ role: "assistant", content });
        appendTranscript(this.workspaceDir, { role: "assistant", content, turn: i });
        return content;
      }
      this.messages.push(msg as unknown as Record<string, unknown>);
      // Loop detection: 3× mismo tool+args seguidos → abort con hint
      for (const call of msg.tool_calls) {
        const key = `${call.function.name}:${call.function.arguments}`;
        recentCalls.push(key);
        if (recentCalls.length > 6) recentCalls.shift();
        const last3 = recentCalls.slice(-3);
        if (last3.length === 3 && last3[0] === last3[1] && last3[1] === last3[2]) {
          const hint = `Loop detectado: ya llamaste 3× "${call.function.name}" con mismos args. Cambia de estrategia o resume.`;
          log.warn({ tool: call.function.name }, hint);
          this.messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: hint });
          return hint;
        }
      }
      // Paralelo throttled (4 concurrentes) para trabajo pesado estable
      const tasks = msg.tool_calls.map((call) => async () => {
          const { name, arguments: rawArgs } = call.function;
          this.onEvent({ type: "tool_call", name, args: rawArgs });
          this.toolLog.debug({ tool: name, args: rawArgs }, "tool_call");
          let result: string;
          const toolDef = toolRegistry.get(name);
          if (this.mode === "plan" && (!toolDef || !toolDef.readOnly)) {
            result =
              `Tool "${name}" no disponible en modo Plan (solo lectura). ` +
              `Pídele al usuario que cambie a modo Build (Tab) si de verdad hace falta escribir o ejecutar algo.`;
          } else {
            try {
              const args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
              if (!toolDef) throw new Error(`Tool desconocida: ${name}`);
              result = await toolDef.execute(args as never, {
                workspaceDir: this.workspaceDir,
                mode: this.mode,
                logger: this.toolLog,
                pauseInput: this.ioControls.pauseInput,
                resumeInput: this.ioControls.resumeInput,
                pauseSpinner: this.ioControls.pauseSpinner,
                resumeSpinner: this.ioControls.resumeSpinner,
              });
            } catch (err) {
              result = `Error ejecutando ${name}: ${(err as Error).message}`;
            }
          }
          const MAX = APP_CONSTANTS.MAX_TOOL_RESULT_CHARS;
          const safeResult = result.length > MAX ? result.slice(0, MAX) + "\n[...resultado truncado... usa offset/limit en read_file para paginar]" : result;
          return { call, safeResult };
        });
      const results = await this.runWithConcurrency(tasks, 4);
      for (const { call, safeResult } of results) {
        this.onEvent({ type: "tool_result", name: call.function.name, result: safeResult });
        this.toolLog.debug({ tool: call.function.name, resultPreview: safeResult.slice(0, 500) }, "tool_result");
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: typeof safeResult === "string" ? safeResult : JSON.stringify(safeResult),
        });
      }
    }
    return `(Se alcanzó el límite de ${MAX_TOOL_ITERATIONS} iteraciones sin respuesta final. Sube DSCODE_MAX_TOOL_ITERATIONS en .env (actual ${MAX_TOOL_ITERATIONS}) o divide la tarea en pasos más pequeños.)`;
  }

  async close(): Promise<void> {
    if (typeof this.client.close === "function") await this.client.close();
  }
}
