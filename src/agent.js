import { toolSchemas, toolExecutors } from "./tools/index.js";

const MAX_TOOL_ITERATIONS = 15; // corta el loop si el modelo se pone en bucle

// En modo Plan el agente puede investigar el proyecto pero no puede tocar
// nada — ni escribir archivos ni ejecutar comandos. Sirve para pedirle
// que piense/proponga un plan sin riesgo de que actúe de una.
const READ_ONLY_TOOLS = new Set(["read_file", "list_directory", "search_files"]);

export class Agent {
  constructor({ client, model, workspaceDir, systemPromptContext, mode = "build", onEvent }) {
    this.client = client;
    this.model = model || "deepseek-chat"; // el modo web ignora este campo
    this.workspaceDir = workspaceDir;
    this.systemPromptContext = systemPromptContext; // ya viene armado desde contextLoader.js
    this.mode = mode; // "plan" | "build"
    this.onEvent = onEvent || (() => {});
    this.messages = [];
  }

  setMode(mode) {
    this.mode = mode;
  }

  init() {
    this.messages.push({ role: "system", content: this.buildSystemPrompt() });
  }

  buildSystemPrompt() {
    return [
      "Eres un agente de programación que trabaja directamente sobre el filesystem de UN proyecto específico.",
      `El workspace de este proyecto es: ${this.workspaceDir}`,
      "NUNCA operes fuera de esa carpeta — tus tools ya están limitadas a ella técnicamente, pero además no debes intentarlo.",
      "",
      "Tienes tools para leer/escribir archivos, listar directorios, ejecutar comandos y buscar texto.",
      "Usa las tools activamente en vez de asumir contenido de archivos que no has leído.",
      "Antes de editar un archivo existente, léelo primero. Antes de asumir la estructura del proyecto, lístala.",
      "Antes de escribir un archivo nuevo, verifica con list_directory que la ruta y carpeta destino son correctas — " +
        "un archivo creado en la carpeta equivocada es un error grave.",
      "Sé conciso en tus explicaciones; concéntrate en actuar y confirmar resultados.",
      "",
      "--- Contexto y reglas del proyecto (AGENTS.md y convenciones) ---",
      this.systemPromptContext,
      "--- Fin del contexto del proyecto ---",
    ].join("\n");
  }

  async run(userInput) {
    this.messages.push({ role: "user", content: userInput });

    const allowedSchemas =
      this.mode === "plan"
        ? toolSchemas.filter((t) => READ_ONLY_TOOLS.has(t.function.name))
        : toolSchemas;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        tools: allowedSchemas,
      });

      const choice = response?.choices?.[0];
      if (!choice?.message) {
        throw new Error(
          "Respuesta inesperada del modelo: no vino 'choices[0].message'. " +
            "Si estás en MODEL_PROVIDER=web, revisa la consola por errores de Playwright."
        );
      }
      const msg = choice.message;

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const content = msg.content ?? "";
        this.messages.push({ role: "assistant", content });
        return content;
      }

      this.messages.push(msg);

      for (const call of msg.tool_calls) {
        const { name, arguments: rawArgs } = call.function;
        this.onEvent({ type: "tool_call", name, args: rawArgs });

        let result;
        if (this.mode === "plan" && !READ_ONLY_TOOLS.has(name)) {
          // Defensa en profundidad: aunque ya no le ofrecimos esta tool al
          // modelo, si de todos modos "alucina" un intento de usarla (más
          // probable en modo scraping, donde el tool-calling es emulado
          // por prompting y menos confiable), la rechazamos igual.
          result = `Tool "${name}" no disponible en modo Plan (solo lectura). ` +
            `Pídele al usuario que cambie a modo Build (Tab) si de verdad hace falta escribir o ejecutar algo.`;
        } else {
          try {
            const args = JSON.parse(rawArgs || "{}");
            const executor = toolExecutors[name];
            if (!executor) throw new Error(`Tool desconocida: ${name}`);
            result = await executor(args, { workspaceDir: this.workspaceDir });
          } catch (err) {
            result = `Error ejecutando ${name}: ${err.message}`;
          }
        }

        this.onEvent({ type: "tool_result", name, result });

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

  async close() {
    if (typeof this.client.close === "function") {
      await this.client.close();
    }
  }
}
