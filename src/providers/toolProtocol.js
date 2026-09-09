/**
 * chat.deepseek.com no tiene function-calling estructurado: solo entiende
 * texto. Para que el agente (agent.js) no tenga que cambiar y siga
 * pensando que habla con una API con tools nativas, este módulo:
 *
 *  1) Convierte el array `tools` (formato OpenAI) en instrucciones de
 *     texto que le explican al modelo qué tools existen y cómo pedir
 *     usarlas.
 *  2) Parsea la respuesta del modelo buscando ese formato, y si lo
 *     encuentra, la convierte de vuelta a la forma `tool_calls` que
 *     espera el SDK de OpenAI.
 *
 * El formato que le pedimos al modelo es un bloque JSON entre marcadores
 * únicos, poco probable que aparezca por accidente en una respuesta normal.
 */

const TOOL_CALL_START = "<<<TOOL_CALL>>>";
const TOOL_CALL_END = "<<<END_TOOL_CALL>>>";

export function buildToolInstructions(tools) {
  if (!tools || tools.length === 0) return "";

  const toolsDescription = tools
    .map((t) => {
      const f = t.function;
      return `- ${f.name}: ${f.description}\n  Parámetros (JSON schema): ${JSON.stringify(f.parameters)}`;
    })
    .join("\n");

  return [
    "",
    "=== HERRAMIENTAS DISPONIBLES ===",
    "Tienes acceso a estas herramientas. Si necesitas usar una para responder bien, NO la ejecutes tú mismo ni inventes el resultado.",
    "En vez de eso, responde ÚNICAMENTE con un bloque exactamente en este formato (nada de texto antes o después):",
    "",
    TOOL_CALL_START,
    '{"name": "nombre_de_la_tool", "arguments": { ...argumentos según el schema... }}',
    TOOL_CALL_END,
    "",
    "Herramientas:",
    toolsDescription,
    "",
    "Si NO necesitas ninguna herramienta, responde en texto breve y directo (LÍMITE ESTRICTO: máx 3-5 frases o 5 viñetas), sin el bloque de arriba.",
    "Cuando te llegue un resultado de herramienta (verás 'Resultado de la herramienta:' en el mensaje), úsalo para continuar o dar tu respuesta final — también breve (1-2 líneas de confirmación).",
    "=== FIN HERRAMIENTAS ===",
  ].join("\n");
}

/**
 * Revisa el texto crudo de respuesta del modelo. Si contiene un bloque de
 * tool call, devuelve { isToolCall: true, name, arguments }. Si no,
 * devuelve { isToolCall: false, content: textoOriginal }.
 */
export function parseModelResponse(rawText) {
  const startIdx = rawText.indexOf(TOOL_CALL_START);
  const endIdx = rawText.indexOf(TOOL_CALL_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { isToolCall: false, content: rawText.trim() };
  }

  const jsonStr = rawText.slice(startIdx + TOOL_CALL_START.length, endIdx).trim();

  // Es común que el modelo, por costumbre (está entrenado para código),
  // envuelva el bloque en un cerco de markdown así aunque se le pida no
  // hacerlo: ```json ... ``` o solo ``` ... ```. Lo toleramos quitándolo
  // antes de intentar parsear, en vez de fallar por un detalle de formato.
  const cleanedJsonStr = jsonStr
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleanedJsonStr);
    return {
      isToolCall: true,
      name: parsed.name,
      arguments: parsed.arguments || {},
    };
  } catch {
    // El modelo mandó un bloque mal formado; lo tratamos como texto normal
    // para no tronar el loop del agente.
    return { isToolCall: false, content: rawText.trim() };
  }
}

export function formatToolResultMessage(toolName, result) {
  const resultText = typeof result === "string" ? result : JSON.stringify(result);
  return `Resultado de la herramienta "${toolName}":\n${resultText}`;
}
