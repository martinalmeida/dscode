const TOOL_CALL_START = "<<<TOOL_CALL>>>";
const TOOL_CALL_END = "<<<END_TOOL_CALL>>>";

export function buildToolInstructions(tools: Array<{ function: { name: string; description?: string; parameters?: unknown } }>): string {
  if (!tools || tools.length === 0) return "";
  const toolsDescription = tools.map((t) => {
    const f = t.function;
    return `- ${f.name}: ${f.description}\n  Parámetros (JSON schema): ${JSON.stringify(f.parameters)}`;
  }).join("\n");
  return ["", "=== HERRAMIENTAS DISPONIBLES ===", "Tienes acceso a estas herramientas. Si necesitas usar una para responder bien, NO la ejecutes tú mismo ni inventes el resultado.", "En vez de eso, responde ÚNICAMENTE con un bloque exactamente en este formato (nada de texto antes o después):", "", TOOL_CALL_START, '{"name": "nombre_de_la_tool", "arguments": { ...argumentos según el schema... }}', TOOL_CALL_END, "", "Herramientas:", toolsDescription, "", "Si NO necesitas ninguna herramienta, responde en texto breve y directo (LÍMITE ESTRICTO: máx 3-5 frases o 5 viñetas), sin el bloque de arriba.", "Cuando te llegue un resultado de herramienta (verás 'Resultado de la herramienta:' en el mensaje), úsalo para continuar o dar tu respuesta final — también breve (1-2 líneas de confirmación).", "=== FIN HERRAMIENTAS ==="].join("\n");
}

export function parseModelResponse(rawText: string): { isToolCall: true; name: string; arguments: Record<string, unknown> } | { isToolCall: false; content: string } {
  const startIdx = rawText.indexOf(TOOL_CALL_START);
  const endIdx = rawText.indexOf(TOOL_CALL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return { isToolCall: false, content: rawText.trim() };
  const jsonStr = rawText.slice(startIdx + TOOL_CALL_START.length, endIdx).trim();
  const cleanedJsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleanedJsonStr) as { name: string; arguments?: Record<string, unknown> };
    if (!parsed.name) return { isToolCall: false, content: rawText.trim() };
    return { isToolCall: true, name: parsed.name, arguments: parsed.arguments || {} };
  } catch {
    return { isToolCall: false, content: rawText.trim() };
  }
}

export function formatToolResultMessage(toolName: string, result: unknown): string {
  const resultText = typeof result === "string" ? result : JSON.stringify(result);
  return `Resultado de la herramienta "${toolName}":\n${resultText}`;
}
