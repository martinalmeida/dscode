const TOOL_CALL_START = "<<<TOOL_CALL>>>";
const TOOL_CALL_END = "<<<END_TOOL_CALL>>>";

export function buildToolInstructions(
  tools: Array<{ function: { name: string; description?: string; parameters?: unknown } }>
): string {
  if (!tools || tools.length === 0) return "";
  const compact = tools
    .map((t) => {
      const params = t.function.parameters as
        { required?: string[]; properties?: Record<string, unknown> } | undefined;
      const required = params?.required?.join(", ") || "";
      const props = Object.keys(params?.properties ?? {}).join(", ");
      return `- ${t.function.name}${required ? ` required=[${required}]` : ""}${props ? ` args={${props}}` : ""}`;
    })
    .join("\n");
  return [
    "",
    "=== DSCODE TOOL PROTOCOL v3 ===",
    "DeepSeek es el motor de razonamiento; dscode ejecuta las herramientas sobre el filesystem real.",
    "Cuando necesites una herramienta, devuelve EXACTAMENTE UN bloque completo y nada más:",
    `${TOOL_CALL_START}{"name":"tool_name","arguments":{...}}${TOOL_CALL_END}`,
    "No envíes dos tools en la misma respuesta. No escribas explicaciones antes o después del bloque.",
    `JSON válido obligatorio. Escapa saltos como \\n y comillas como " dentro de strings.`,
    "En BUILD: inspecciona solo lo necesario; después edita. Para archivos existentes prefiere apply_patch corto. Para archivos nuevos usa write_file.",
    "No afirmes que un archivo cambió: espera el resultado de la herramienta y su campo changed=true.",
    "Si una edición falla, cambia de estrategia; no repitas idénticamente la misma llamada tres veces.",
    "Herramientas:",
    compact,
    "=== END DSCODE TOOL PROTOCOL ===",
  ].join("\n");
}

function sanitizeJsonEscapes(jsonStr: string): string {
  // JSON solo permite \" \\ \/ \b \f \n \r \t \uXXXX. El modelo frecuentemente genera
  // `\*`, `\{`, `\<` (ej. search_files pattern "<Section...|{/\* ") que rompe JSON.parse.
  // Escapamos toda barra que no inicie un escape válido.
  // Evitamos tocar \\ ya válido y \u (requiere 4 hex, pero lo consideramos válido aquí
  // y dejamos que JSON.parse valide).
  return jsonStr.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
}

function trySanitizedParse(c: string): { name: string; arguments: Record<string, unknown> } | null {
  const sanitized = sanitizeJsonEscapes(c);
  if (sanitized === c) return null;
  try {
    const p = JSON.parse(sanitized) as { name: string; arguments?: Record<string, unknown> };
    if (p.name) return { name: p.name, arguments: p.arguments || {} };
  } catch (_e) {
    void _e;
  }
  return null;
}

function tryParseBlock(
  cleaned: string
): { name: string; arguments: Record<string, unknown> } | null {
  let c = cleaned
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!c.startsWith("{")) {
    const fb = c.indexOf("{");
    const lb = c.lastIndexOf("}");
    if (fb !== -1 && lb !== -1 && lb > fb) c = c.slice(fb, lb + 1);
  }
  try {
    const p = JSON.parse(c) as { name: string; arguments?: Record<string, unknown> };
    if (p.name) return { name: p.name, arguments: p.arguments || {} };
  } catch (_e) {
    void _e;
  }
  const sanitized = trySanitizedParse(c);
  if (sanitized) return sanitized;
  const lenient = parseLenientWriteFile(c) || parseLenientEditFile(c);
  if (lenient)
    return { name: lenient.name, arguments: lenient.arguments as Record<string, unknown> };
  const genericLenient = parseLenientGeneric(c);
  if (genericLenient) return genericLenient;
  const match = c.match(/\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}/);
  if (match) {
    try {
      const p2 = JSON.parse(match[0]) as { name: string; arguments?: Record<string, unknown> };
      if (p2.name) return { name: p2.name, arguments: p2.arguments || {} };
    } catch (_e2) {
      void _e2;
    }
    const mSan = trySanitizedParse(match[0]);
    if (mSan) return mSan;
  }
  return null;
}

function parseLenientGeneric(
  cleaned: string
): { isToolCall: true; name: string; arguments: Record<string, unknown> } | null {
  // Fallback genérico para tools no-write/edit (ej. search_files) con escapes inválidos.
  // Extrae name/path/pattern/include con regex tolerante y des-escapa con JSON.parse trick.
  const nameMatch = cleaned.match(/"name"\s*:\s*"([^"]+)"/);
  const name = nameMatch?.[1];
  if (!name) return null;
  const args: Record<string, unknown> = {};
  // Extrae todos los pares "key":"value" con manejo de escapes simples
  const kvRe = /"([a-zA-Z0-9_]+)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let kv: RegExpExecArray | null;
  let found = false;
  while ((kv = kvRe.exec(cleaned)) !== null) {
    const k = kv[1]!;
    if (k === "name") continue;
    let v: string = kv[2]!;
    // Des-escape: intenta JSON.parse("\""+v+"\"") con sanitización
    const rawQuoted = `"${v.replace(/\n/g, "\\n")}"`;
    try {
      v = JSON.parse(rawQuoted);
    } catch {
      try {
        v = JSON.parse(`"${sanitizeJsonEscapes(v).replace(/\n/g, "\\n")}"`);
      } catch {
        v = v
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    }
    args[k] = v;
    found = true;
  }
  if (!found) return null;
  // Sanitizar escapes inválidos dentro de valores ya extraídos nunca dañará,
  // pero asegura que pattern con `/*` no rompa.
  return { isToolCall: true, name, arguments: args };
}

export function parseModelResponseMulti(
  rawText: string
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const norm = rawText
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\r/g, "");
  const re = /<<<TOOL_CALL>>>([\s\S]*?)<<<END_TOOL_CALL>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const parsed = tryParseBlock(m[1] ?? "");
    if (parsed) return [parsed];
  }
  if (norm.includes("<<<TOOL_CALL>>>")) {
    const startIdx = norm.indexOf("<<<TOOL_CALL>>>");
    const after = norm.slice(startIdx + "<<<TOOL_CALL>>>".length);
    const fb = after.indexOf("{");
    const lb = after.lastIndexOf("}");
    if (fb !== -1 && lb > fb) {
      const parsed = tryParseBlock(after.slice(fb, lb + 1));
      if (parsed) return [parsed];
    }
  }
  return [];
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
      const after = norm.slice(
        startIdx +
          (norm.slice(startIdx).startsWith(TOOL_CALL_START)
            ? TOOL_CALL_START.length
            : (norm.match(/<<<\s*TOOL_CALL\s*>>>/)?.[0].length ?? TOOL_CALL_START.length))
      );
      const fb = after.indexOf("{");
      const lb = after.lastIndexOf("}");
      if (fb !== -1 && lb !== -1 && lb > fb) {
        const cleaned2 = after.slice(fb, lb + 1).trim();
        try {
          const p = JSON.parse(cleaned2) as { name: string; arguments?: Record<string, unknown> };
          if (p.name) return { isToolCall: true, name: p.name, arguments: p.arguments || {} };
        } catch (_e) {
          void _e;
        }
        const san2 = sanitizeJsonEscapes(cleaned2);
        if (san2 !== cleaned2) {
          try {
            const pSan = JSON.parse(san2) as { name: string; arguments?: Record<string, unknown> };
            if (pSan.name)
              return { isToolCall: true, name: pSan.name, arguments: pSan.arguments || {} };
          } catch (_e) {
            void _e;
          }
        }
        const lenient2 =
          parseLenientWriteFile(cleaned2) ||
          parseLenientEditFile(cleaned2) ||
          parseLenientGeneric(cleaned2);
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
    const sanitized = sanitizeJsonEscapes(cleaned);
    if (sanitized !== cleaned) {
      try {
        const pSan = JSON.parse(sanitized) as { name: string; arguments?: Record<string, unknown> };
        if (pSan.name)
          return { isToolCall: true, name: pSan.name, arguments: pSan.arguments || {} };
      } catch (_e) {
        void _e;
      }
    }
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
      const mSan = sanitizeJsonEscapes(match[0]);
      if (mSan !== match[0]) {
        try {
          const pSan2 = JSON.parse(mSan) as { name: string; arguments?: Record<string, unknown> };
          if (pSan2.name)
            return { isToolCall: true, name: pSan2.name, arguments: pSan2.arguments || {} };
        } catch (_e) {
          void _e;
        }
      }
    }
    const lenient = parseLenientWriteFile(cleaned);
    if (lenient) return lenient;
    const lenientEdit = parseLenientEditFile(cleaned);
    if (lenientEdit) return lenientEdit;
    const genericLenient = parseLenientGeneric(cleaned);
    if (genericLenient) return genericLenient;
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
        } catch {
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
          } catch {
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
