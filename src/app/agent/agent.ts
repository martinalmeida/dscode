import { toolRegistry } from "../../domain/tools/index.js";
import { buildSystemPrompt } from "./prompt.js";
import { MAX_TOOL_ITERATIONS } from "./modes.js";
import { createLogger } from "../../infrastructure/logger/logger.js";
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
  model?: string;
  workspaceDir: string;
  systemPromptContext: string;
  mode?: AgentMode;
  onEvent?: (e: { type: string; name: string; args?: string; result?: string }) => void;
}

export class Agent {
  private client: ModelClient;
  private model: string;
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
    this.model = opts.model || "deepseek-chat";
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

  async run(userInput: string): Promise<string> {
    if (this.messages.length === 0) this.init();
    this.messages.push({ role: "user", content: userInput });
    const allSchemas = toolRegistry.getSchemas();
    const allowedSchemas =
      this.mode === "plan" ? toolRegistry.getSchemasForMode("plan") : allSchemas;
    log.debug({ mode: this.mode, toolCount: allowedSchemas.length }, "run iniciado");

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response: ChatResponse = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        tools: allowedSchemas,
      } as never);
      const choice = response?.choices?.[0];
      if (!choice?.message) {
        throw new Error(
          "Respuesta inesperada del modelo: no vino 'choices[0].message'. Si estás en MODEL_PROVIDER=web, revisa la consola por errores de Playwright."
        );
      }
      const msg = choice.message;
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const content = (msg.content as string | null) ?? "";
        this.messages.push({ role: "assistant", content });
        return content;
      }
      this.messages.push(msg as unknown as Record<string, unknown>);
      for (const call of msg.tool_calls) {
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
        this.onEvent({ type: "tool_result", name, result });
        this.toolLog.debug({ tool: name, resultPreview: result.slice(0, 500) }, "tool_result");
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
    }
    return "(Se alcanzó el límite de iteraciones de tools sin llegar a una respuesta final. Revisa el prompt o sube MAX_TOOL_ITERATIONS.)";
  }

  async close(): Promise<void> {
    if (typeof this.client.close === "function") await this.client.close();
  }
}
