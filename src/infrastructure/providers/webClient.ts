import { createSession, sendMessage, resumeReadResponse, startNewChat, closeSession, type Session } from "../browser/session.js";
import { buildToolInstructions, parseModelResponse, formatToolResultMessage } from "./toolProtocol.js";

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
  public chat: { completions: { create: (args: { messages: Array<{ role: string; content?: string | null; name?: string }>; tools?: Array<{ function: { name: string; description?: string; parameters?: unknown } }>; model?: string }) => Promise<{ id: string; choices: Array<{ message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }> }> } };

  constructor(config: WebClientConfig) {
    this.config = config;
    this.chat = { completions: { create: this._createCompletion.bind(this) } };
  }

  private async _getSession(): Promise<Session> {
    if (this._session) return this._session;
    if (!this._sessionPromise) {
      this._sessionPromise = createSession(this.config).then((s) => {
        this._session = s;
        return s;
      });
    }
    return this._sessionPromise;
  }

  async close(): Promise<void> {
    if (this._session) { await closeSession(this._session); this._session = null; }
  }

  private async _createCompletion(opts: { messages: Array<{ role: string; content?: string | null; name?: string }>; tools?: Array<{ function: { name: string; description?: string; parameters?: unknown } }>; model?: string }): Promise<{ id: string; choices: Array<{ message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }> }> {
    const session = await this._getSession();
    const { messages, tools } = opts;
    const isFreshConversation = session.historyLength === 0 || messages.length <= session.historyLength;
    let rawResponse: string;
    if (isFreshConversation) {
      if (session.historyLength !== 0) await startNewChat(session);
      const toolInstructions = buildToolInstructions(tools ?? []);
      const body = messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content ?? ""}`).join("\n\n");
      const textToSend = toolInstructions ? `${body}\n\n${toolInstructions}` : body;
      rawResponse = await sendMessage(session, textToSend, { onSubmitted: () => { session.historyLength = messages.length + 1; } });
    } else {
      const newMessages = messages.slice(session.historyLength);
      if (newMessages.length === 0) rawResponse = await resumeReadResponse(session);
      else {
        const textToSend = newMessages.map((m) => (m.role === "tool" ? formatToolResultMessage(m.name || "tool", m.content) : `[${m.role.toUpperCase()}]\n${m.content ?? ""}`)).join("\n\n");
        rawResponse = await sendMessage(session, textToSend, { onSubmitted: () => { session.historyLength = messages.length + 1; } });
      }
    }
    const parsed = parseModelResponse(rawResponse);
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
    return { id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, choices: [{ message: message as unknown as { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }] };
  }
}
