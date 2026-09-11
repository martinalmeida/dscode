const TOOL_CALL_START = "<<<TOOL_CALL>>>";
const TOOL_CALL_END = "<<<END_TOOL_CALL>>>";

export function buildToolInstructions(
  tools: Array<{ function: { name: string; description?: string; parameters?: unknown } }>
): string {
  if (!tools || tools.length === 0) return "";
  // Heavy short mode: evita 4k de ejemplos que revientan fill (ver m0112)
  const shortEnv = (globalThis as unknown as { process?: { env?: Record<string,string> } }).process?.env?.DSCODE_SHORT_TOOL_INSTRUCTIONS;
  const useShort = shortEnv === undefined ? true : ["true","1","yes","on","sí","si"].includes(shortEnv.toLowerCase());
  if (useShort && tools.length >= 8) {
    const short = tools.map(t=>`- ${t.function.name}: ${(t.function.description||"").slice(0,80)}`).join("\n");
    return ["","=== HERRAMIENTAS DISPONIBLES (modo corto) ===","Responde con <<<TOOL_CALL>>>{\"name\":\"tool\",\"arguments\":{...}}<<<END_TOOL_CALL>>> si necesitas tool. Formato JSON estricto (\\n y \\\" escapados).","Herramientas:",short,"Si no necesitas tool, responde texto breve (3-5 frases).","=== FIN HERRAMIENTAS ==="].join("\n");
  }
  const toolsDescription = tools
    .map((t) => {
      const f = t.function;
      const params = f.parameters as
        | {
            required?: string[];
            properties?: Record<string, { type?: string; description?: string }>;
          }
        | undefined;
      const required = params?.required ?? [];
      const props = params?.properties ?? {};
      const paramLines = Object.entries(props)
        .map(
          ([key, def]) =>
            `    - ${key} (${def.type ?? "unknown"}${required.includes(key) ? ", requerido" : ""}): ${def.description ?? ""}`
        )
        .join("\n");
      const requiredLine = required.length > 0 ? `  Requeridos: ${required.join(", ")}` : "";
      return `- ${f.name}: ${f.description}\n${requiredLine}\n${paramLines}`;
    })
    .join("\n\n");
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
    "Ejemplos válidos:",
    `${TOOL_CALL_START}{"name": "write_file", "arguments": {"path": "hola.md", "content": "# Hola\\nhola como estas"}}${TOOL_CALL_END}`,
    `${TOOL_CALL_START}{"name": "read_file", "arguments": {"path": "README.md"}}${TOOL_CALL_END}`,
    `${TOOL_CALL_START}{"name": "glob", "arguments": {"pattern": "**/*.tsx"}}${TOOL_CALL_END}`,
    `${TOOL_CALL_START}{"name": "search_files", "arguments": {"pattern": "BackgroundContext", "include": "*.tsx"}}${TOOL_CALL_END}`,
    `${TOOL_CALL_START}{"name": "delete_file", "arguments": {"path": "xddvd.md"}}${TOOL_CALL_END}`,
    `${TOOL_CALL_START}{"name": "edit_file", "arguments": {"path": "index.html", "old_string": "  <title>Viejo</title>", "new_string": "  <title>Nuevo</title>"}}${TOOL_CALL_END}`,
    "Anti-ejemplo (NUNCA hagas esto):",
    `${TOOL_CALL_START}{"name": "write_file", "arguments": {}}${TOOL_CALL_END} ← PROHIBIDO: vacío. Siempre rellena todos los requeridos.`,
    "IMPORTANTE: nunca llames una tool con {} vacío. Si te falta un dato, infiérelo del pedido del usuario o usa list_directory/read_file primero, pero siempre rellena todos los requeridos.",
    'CRÍTICO JSON: el bloque debe ser JSON válido. Dentro de "content"/"old_string"/"new_string" escapa SIEMPRE saltos de línea como \\n y comillas dobles como \\" . Nunca escribas HTML con saltos reales o comillas sin escapar dentro del JSON (ej: "<html lang=\\"es\\">\\n<head>" no "<html lang="es">\n<head>"). Si no escapas, el parse fallará. ACLARACIÓN: \\n en JSON se convierte en salto real en disco — el archivo NO queda en una sola línea; no uses run_command/heredoc para escribir y no digas que quedó en una línea por serialización. Genera SIEMPRE content indentado a 2 espacios (cada tag/bloque en línea separada, no minificado) como lo haría un humano.',
    "Para edición parcial: usa edit_file (requiere read_file primero para copiar old_string exacto con indentación). No uses write_file para cambiar 1-2 líneas.",
    "Para acciones destructivas (delete_file, sobrescribir, rm): NO preguntes '¿Confirmas?' en texto. Llama directo a la tool; ella pedirá [s/N] en terminal.",
    "",
    "Si NO necesitas ninguna herramienta, responde en texto breve y directo (LÍMITE ESTRICTO: máx 3-5 frases o 5 viñetas), sin el bloque de arriba.",
    "Cuando te llegue un resultado de herramienta (verás 'Resultado de la herramienta:' en el mensaje), úsalo para continuar o dar tu respuesta final — también breve (1-2 líneas de confirmación).",
    "=== FIN HERRAMIENTAS ===",
  ].join("\n");
}

function tryParseBlock(cleaned: string): { name: string; arguments: Record<string, unknown> } | null {
  let c = cleaned.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!c.startsWith("{")) {
    const fb = c.indexOf("{");
    const lb = c.lastIndexOf("}");
    if (fb !== -1 && lb !== -1 && lb > fb) c = c.slice(fb, lb + 1);
  }
  try {
    const p = JSON.parse(c) as { name: string; arguments?: Record<string, unknown> };
    if (p.name) return { name: p.name, arguments: p.arguments || {} };
  } catch (_e) { void _e; }
  const lenient = parseLenientWriteFile(c) || parseLenientEditFile(c);
  if (lenient) return { name: lenient.name, arguments: lenient.arguments as Record<string, unknown> };
  const match = c.match(/\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}/);
  if (match) try { const p2 = JSON.parse(match[0]) as { name: string; arguments?: Record<string, unknown> }; if (p2.name) return { name: p2.name, arguments: p2.arguments || {} }; } catch (_e2) { void _e2; }
  return null;
}

export function parseModelResponseMulti(rawText: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const norm = rawText.replace(/\u00A0/g, " ").replace(/[\u200B\uFEFF]/g, "").replace(/\r/g, "");
  const re = /<<<TOOL_CALL>>>([\s\S]*?)<<<END_TOOL_CALL>>>/g;
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const parsed = tryParseBlock(m[1] ?? "");
    if (parsed) calls.push(parsed);
  }
  // Fallback tolerante: texto previo + TOOL_CALL sin END (caso landing bloqueado)
  if (calls.length === 0 && norm.includes("<<<TOOL_CALL>>>")) {
    const startIdx = norm.indexOf("<<<TOOL_CALL>>>");
    let after = norm.slice(startIdx + "<<<TOOL_CALL>>>".length);
    // Si hay END, ya se habría parseado; sin END, tomar hasta último } balanceado
    const fb = after.indexOf("{");
    const lb = after.lastIndexOf("}");
    if (fb !== -1 && lb !== -1 && lb > fb) {
      after = after.slice(fb, lb + 1);
      const parsed = tryParseBlock(after);
      if (parsed) calls.push(parsed);
    }
  }
  return calls;
}

export function parseModelResponse(
  rawText: string
):
  | { isToolCall: true; name: string; arguments: Record<string, unknown> }
  | { isToolCall: false; content: string } {
  const norm = rawText
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\r/g, "");
  let startIdx = norm.indexOf(TOOL_CALL_START);
  let endIdx = norm.indexOf(TOOL_CALL_END);
  if (startIdx === -1) {
    const m = norm.match(/<<<\s*TOOL_CALL\s*>>>/);
    if (m && m.index !== undefined) startIdx = m.index;
  }
  if (endIdx === -1) {
    const m = norm.match(/<<<\s*END_TOOL_CALL\s*>>>/);
    if (m && m.index !== undefined) endIdx = m.index;
  }
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    // Fallback sin END: intenta extraer JSON tras START hasta último } (caso truncado)
    if (startIdx !== -1) {
      let after = norm.slice(startIdx + (norm.slice(startIdx).startsWith(TOOL_CALL_START) ? TOOL_CALL_START.length : (norm.match(/<<<\s*TOOL_CALL\s*>>>/)?.[0].length ?? TOOL_CALL_START.length)));
      const fb = after.indexOf("{");
      const lb = after.lastIndexOf("}");
      if (fb !== -1 && lb !== -1 && lb > fb) {
        const cleaned2 = after.slice(fb, lb + 1).trim();
        try { const p = JSON.parse(cleaned2) as { name: string; arguments?: Record<string, unknown> }; if (p.name) return { isToolCall: true, name: p.name, arguments: p.arguments || {} }; } catch (_e) { void _e; }
        const lenient2 = parseLenientWriteFile(cleaned2) || parseLenientEditFile(cleaned2);
        if (lenient2) return lenient2;
      }
    }
    return { isToolCall: false, content: norm.trim() };
  }
  const startLen = norm.slice(startIdx).startsWith(TOOL_CALL_START)
    ? TOOL_CALL_START.length
    : (norm.match(/<<<\s*TOOL_CALL\s*>>>/)?.[0].length ?? TOOL_CALL_START.length);
  const jsonStr = norm.slice(startIdx + startLen, endIdx).trim();
  let cleaned = jsonStr
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!cleaned.startsWith("{")) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace)
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(cleaned) as { name: string; arguments?: Record<string, unknown> };
    if (!parsed.name) return { isToolCall: false, content: norm.trim() };
    return { isToolCall: true, name: parsed.name, arguments: parsed.arguments || {} };
  } catch {
    const match = cleaned.match(/\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}/);
    if (match) {
      try {
        const parsed2 = JSON.parse(match[0]) as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        if (parsed2.name)
          return { isToolCall: true, name: parsed2.name, arguments: parsed2.arguments || {} };
      } catch (_e) {
        void _e;
      }
    }
    const lenient = parseLenientWriteFile(cleaned);
    if (lenient) return lenient;
    const lenientEdit = parseLenientEditFile(cleaned);
    if (lenientEdit) return lenientEdit;
    return { isToolCall: false, content: norm.trim() };
  }
}

function parseLenientWriteFile(
  cleaned: string
): { isToolCall: true; name: string; arguments: Record<string, unknown> } | null {
  const nameMatch = cleaned.match(/"name"\s*:\s*"([^"]+)"/);
  const name = nameMatch?.[1];
  if (!name) return null;
  if (name !== "write_file" && !cleaned.includes('"content"')) return null;
  if (!cleaned.includes('"content"')) return null;
  const pathMatch = cleaned.match(/"path"\s*:\s*"([^"]*)"/);
  const pathVal = pathMatch?.[1];
  if (pathVal === undefined) return null;
  const patterns = [
    /"content"\s*:\s*"([\s\S]*)"\s*\}\s*\}\s*$/,
    /"content"\s*:\s*"([\s\S]*)"\s*\}\s*,/,
    /"content"\s*:\s*"([\s\S]*)"\s*"\s*\}\s*\}/,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m && m[1] !== undefined) {
      let contentVal = m[1];
      // Unescape \n literales a saltos reales (fix archivo en 1 línea)
      if (contentVal.includes("\\n") || contentVal.includes("\\r") || contentVal.includes('\\"')) {
        try {
          contentVal = JSON.parse(`"${contentVal.replace(/\n/g, "\\n")}"`);
        } catch (_e) {
          contentVal = contentVal
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"');
        }
      }
      return { isToolCall: true, name, arguments: { path: pathVal, content: contentVal } };
    }
  }
  const contentKeyIdx = cleaned.indexOf('"content"');
  if (contentKeyIdx !== -1) {
    const colonIdx = cleaned.indexOf(":", contentKeyIdx);
    const openQuoteIdx = cleaned.indexOf('"', colonIdx);
    const closeAnchor = cleaned.lastIndexOf('"}}');
    if (openQuoteIdx !== -1 && closeAnchor !== -1 && closeAnchor > openQuoteIdx) {
      const endQuoteIdx = cleaned.lastIndexOf('"', closeAnchor);
      if (endQuoteIdx > openQuoteIdx) {
        let contentVal = cleaned.slice(openQuoteIdx + 1, endQuoteIdx);
        if (contentVal.includes("\\n")) {
          try {
            contentVal = JSON.parse(`"${contentVal.replace(/\n/g, "\\n")}"`);
          } catch (_e) {
            contentVal = contentVal.replace(/\\n/g, "\n");
          }
        }
        return { isToolCall: true, name, arguments: { path: pathVal, content: contentVal } };
      }
    }
  }
  return null;
}

function parseLenientEditFile(
  cleaned: string
): { isToolCall: true; name: string; arguments: Record<string, unknown> } | null {
  const nameMatch = cleaned.match(/"name"\s*:\s*"([^"]+)"/);
  const name = nameMatch?.[1];
  if (name !== "edit_file") return null;
  const pathMatch = cleaned.match(/"path"\s*:\s*"([^"]*)"/);
  const pathVal = pathMatch?.[1];
  if (pathVal === undefined) return null;
  // Extraer old_string y new_string con greedy tolerante
  const oldMatch = cleaned.match(/"old_string"\s*:\s*"([\s\S]*?)"\s*,\s*"new_string"/);
  const newMatch = cleaned.match(/"new_string"\s*:\s*"([\s\S]*)"\s*\}\s*\}\s*$/);
  if (oldMatch && newMatch && oldMatch[1] !== undefined && newMatch[1] !== undefined) {
    let oldStr: string = oldMatch[1];
    let newStr: string = newMatch[1];
    try {
      oldStr = JSON.parse(`"${oldStr.replace(/\n/g, "\\n")}"`);
    } catch (_e) {
      void _e;
      oldStr = oldStr.replace(/\\n/g, "\n");
    }
    try {
      newStr = JSON.parse(`"${newStr.replace(/\n/g, "\\n")}"`);
    } catch (_e) {
      void _e;
      newStr = newStr.replace(/\\n/g, "\n");
    }
    return {
      isToolCall: true,
      name,
      arguments: { path: pathVal, old_string: oldStr, new_string: newStr },
    };
  }
  return null;
}

export function formatToolResultMessage(toolName: string, result: unknown): string {
  const resultText = typeof result === "string" ? result : JSON.stringify(result);
  return `Resultado de la herramienta "${toolName}":\n${resultText}`;
}
