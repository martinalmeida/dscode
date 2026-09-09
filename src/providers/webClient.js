import { createSession, sendMessage, resumeReadResponse, startNewChat, closeSession } from "../browser/session.js";
import { buildToolInstructions, parseModelResponse, formatToolResultMessage } from "./toolProtocol.js";

/**
 * Imita la forma del SDK de OpenAI: `client.chat.completions.create(...)`.
 * Por dentro, en vez de hacer una petición HTTP a una API real, controla
 * Chromium con Playwright directamente en el mismo proceso — sin
 * servidor Express, sin puerto, sin segundo proceso. Así agent.js no
 * necesita saber si está hablando con la API real o con el scraping.
 *
 * También reemplaza el rol que tenía server.js: aprovechar la memoria
 * propia del chat de DeepSeek mandando solo los mensajes NUEVOS en cada
 * turno, en vez de reenviar todo el historial.
 */
export class DeepSeekWebClient {
  constructor(config) {
    this.config = config;
    this._session = null;
    this.chat = {
      completions: {
        create: this._createCompletion.bind(this),
      },
    };
  }

  async _getSession() {
    if (!this._session) {
      this._session = await createSession(this.config);
    }
    return this._session;
  }

  async close() {
    if (this._session) {
      await closeSession(this._session);
      this._session = null;
    }
  }

  async _createCompletion({ messages, tools }) {
    const session = await this._getSession();

    const isFreshConversation = session.historyLength === 0 || messages.length <= session.historyLength;

    let rawResponse;

    if (isFreshConversation) {
      if (session.historyLength !== 0) {
        await startNewChat(session);
      }
      const toolInstructions = buildToolInstructions(tools);
      const body = messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content ?? ""}`).join("\n\n");
      const textToSend = toolInstructions ? `${body}\n\n${toolInstructions}` : body;

      rawResponse = await sendMessage(session, textToSend, {
        // Se marca como enviado ANTES de esperar la respuesta: si algo
        // falla mientras se espera, un reintento no reescribe el mismo texto.
        onSubmitted: () => {
          session.historyLength = messages.length + 1;
        },
      });
    } else {
      const newMessages = messages.slice(session.historyLength);

      if (newMessages.length === 0) {
        // No hay nada nuevo que escribir: un intento anterior ya alcanzó
        // a enviar el texto (onSubmitted se disparó) pero falló antes de
        // leer la respuesta. Reanudamos la lectura en vez de reenviar.
        rawResponse = await resumeReadResponse(session);
      } else {
        const textToSend = newMessages
          .map((m) =>
            m.role === "tool"
              ? formatToolResultMessage(m.name || "tool", m.content)
              : `[${m.role.toUpperCase()}]\n${m.content ?? ""}`
          )
          .join("\n\n");

        rawResponse = await sendMessage(session, textToSend, {
          onSubmitted: () => {
            session.historyLength = messages.length + 1;
          },
        });
      }
    }

    const parsed = parseModelResponse(rawResponse);

    const message = parsed.isToolCall
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${Date.now()}`,
              type: "function",
              function: {
                name: parsed.name,
                arguments: JSON.stringify(parsed.arguments),
              },
            },
          ],
        }
      : { role: "assistant", content: parsed.content };

    return {
      id: `web-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-web",
      choices: [
        {
          index: 0,
          message,
          finish_reason: parsed.isToolCall ? "tool_calls" : "stop",
        },
      ],
    };
  }
}
