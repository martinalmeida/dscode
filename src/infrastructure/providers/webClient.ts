import {
  createSession,
  sendMessage,
  resumeReadResponse,
  startNewChat,
  closeSession,
  type Session,
} from "../browser/session.js";
import {
  buildToolInstructions,
  parseModelResponseMulti,
  parseModelResponse,
  formatToolResultMessage,
} from "./toolProtocol.js";
import { createLogger } from "../logger/logger.js";
import { getEnvNumber } from "../../shared/env.js";

const log = createLogger("providers:webClient");

export interface WebClientConfig {
  chatUrl: string;
  headless: boolean;
  storageStatePath: string;
  responseTimeoutMs: number;
  chromiumExecutablePath?: string;
}

export class DeepSeekWebClient {
  private config: WebClientConfig;
  private _session: Session | null = null;
  private _sessionPromise: Promise<Session> | null = null;
  public chat: {
    completions: {
      create: (args: {
        messages: Array<{ role: string; content?: string | null; name?: string }>;
        tools?: Array<{ function: { name: string; description?: string; parameters?: unknown } }>;
        model?: string;
      }) => Promise<{
        id: string;
        choices: Array<{
          message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      }>;
    };
  };

  constructor(config: WebClientConfig) {
    this.config = config;
    this.chat = { completions: { create: this._createCompletion.bind(this) } };
  }

  private async _getSession(): Promise<Session> {
    if (this._session) {
      try {
        if ((this._session.browser as unknown as { isConnected?: () => boolean })?.isConnected?.() === false) {
          log.warn("Browser desconectado — recreando sesión");
          this._session = null;
          this._sessionPromise = null;
        } else if ((this._session.page as unknown as { isClosed?: () => boolean })?.isClosed?.()) {
          log.warn("Page cerrada — recreando sesión");
          this._session = null;
          this._sessionPromise = null;
        } else return this._session;
      } catch (_e) {
        void _e;
      }
    }
    if (!this._sessionPromise) {
      this._sessionPromise = createSession(this.config)
        .then((s) => {
          this._session = s;
          return s;
        })
        .catch((err) => {
          this._sessionPromise = null;
          throw err;
        });
    }
    return this._sessionPromise;
  }

  async close(): Promise<void> {
    if (this._session) {
      await closeSession(this._session);
      this._session = null;
    }
    this._sessionPromise = null;
  }

  private async sendWithRetry(session: import("../browser/session.js").Session, text: string, opts: { onSubmitted?: () => void }): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await sendMessage(session, text, opts);
      } catch (err) {
        const msg = (err as Error).message || "";
        const retryable = /Target closed|Page closed|browser has been closed|Execution context was destroyed|Timeout.*fill|waiting for locator.*textarea|textarea mismatch|textarea evaluate|sendButton disabled/i.test(msg);
        if (!retryable || attempt === 1) throw err;
        log.warn({ err: msg.slice(0,400), attempt }, "sendMessage falló — recreando sesión y reintentando");
        this._session = null;
        this._sessionPromise = null;
        session = await this._getSession();
      }
    }
    throw new Error("sendWithRetry: unreachable");
  }

  private capTextToSend(text: string): string {
    const cap = getEnvNumber("DSCODE_MAX_SEND_CHARS", 16000);
    if (text.length <= cap) return text;
    const head = text.slice(0, cap - 800);
    const tail = `\n\n[...payload truncado: ${text.length} chars -> ${cap} cap (DSCODE_MAX_SEND_CHARS). Contexto recortado para evitar textarea mismatch. Usa read_file/glob bajo demanda — no reintentes mandar 20k+ en un solo mensaje.]`;
    log.warn({ before: text.length, cap }, "textToSend truncado por DSCODE_MAX_SEND_CHARS");
    return head + tail;
  }

  private async _createCompletion(opts: {
    messages: Array<{ role: string; content?: string | null; name?: string }>;
    tools?: Array<{ function: { name: string; description?: string; parameters?: unknown } }>;
    model?: string;
  }): Promise<{
    id: string;
    choices: Array<{
      message: {
        role: string;
        content: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  }> {
    const session = await this._getSession();
    const { messages, tools } = opts;
    const isFreshConversation =
      session.historyLength === 0 || messages.length <= session.historyLength;
    let rawResponse: string;
    if (isFreshConversation) {
      if (session.historyLength !== 0) await startNewChat(session);
      const toolInstructions = buildToolInstructions(tools ?? []);
      const body = messages
        .map((m) => `[${m.role.toUpperCase()}]\n${m.content ?? ""}`)
        .join("\n\n");
      let textToSend = toolInstructions ? `${body}\n\n${toolInstructions}` : body;
      textToSend = this.capTextToSend(textToSend);
      rawResponse = await this.sendWithRetry(session, textToSend, {
        onSubmitted: () => {
          session.historyLength = messages.length + 1;
        },
      });
    } else {
      const newMessages = messages.slice(session.historyLength);
      if (newMessages.length === 0) rawResponse = await resumeReadResponse(session);
      else {
        let textToSend = newMessages
          .map((m) => {
            const role = (m as { role?: string }).role;
            if (role === "tool")
              return formatToolResultMessage(
                (m as { name?: string }).name || "tool",
                (m as { content?: string | null }).content
              );
            if (
              role === "assistant" &&
              (
                m as unknown as {
                  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
                }
              ).tool_calls
            ) {
              const calls = (
                m as unknown as {
                  tool_calls: Array<{ function: { name: string; arguments: string } }>;
                }
              ).tool_calls;
              return `[ASSISTANT_TOOL_CALLS]\n${calls.map((c) => `${c.function.name}(${c.function.arguments})`).join("\n")}`;
            }
            return `[${String(role ?? "UNKNOWN").toUpperCase()}]\n${(m as { content?: string | null }).content ?? ""}`;
          })
          .join("\n\n");
        textToSend = this.capTextToSend(textToSend);
        rawResponse = await this.sendWithRetry(session, textToSend, {
          onSubmitted: () => {
            session.historyLength = messages.length + 1;
          },
        });
      }
    }
    log.debug(
      { rawLen: rawResponse.length, preview: rawResponse.slice(0, 300) },
      "rawResponse recibido"
    );
    const multi = parseModelResponseMulti(rawResponse);
    if (multi.length > 0) {
      const message = {
        role: "assistant" as const,
        content: null,
        tool_calls: multi.map((c, i) => ({
          id: `call_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          type: "function" as const,
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      };
      return {
        id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        choices: [{ message: message as unknown as { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }],
      };
    }
    const parsed = parseModelResponse(rawResponse);
    if (!parsed.isToolCall && rawResponse.includes("<<<TOOL_CALL>>>")) {
      log.warn(
        { rawPreview: rawResponse.slice(0, 500) },
        "rawResponse contenía TOOL_CALL pero parse falló — revisa parseModelResponse"
      );
    }
    const message = parsed.isToolCall
      ? {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: "function" as const,
              function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments) },
            },
          ],
        }
      : { role: "assistant" as const, content: parsed.content };
    return {
      id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      choices: [
        {
          message: message as unknown as {
            role: string;
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          },
        },
      ],
    };
  }
}
