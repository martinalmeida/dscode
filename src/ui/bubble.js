const RESET = "\x1b[0m";

// Fondos sutiles grises 256-colores — distintos para diferenciar sin ser chillones
const BG_USER = "\x1b[48;5;236m";
const BG_AGENT = "\x1b[48;5;235m";
const BG_TOOL = "\x1b[48;5;236m";

const FG_USER_PREFIX = "\x1b[94m\x1b[1m"; // azul brillante
const FG_AGENT_PREFIX = "\x1b[95m\x1b[1m"; // morado brillante
const FG_TOOL_PREFIX = "\x1b[33m"; // amarillo
const FG_WHITE = "\x1b[97m";
const FG_DIM = "\x1b[2m";

function wrapWithBg(lines, bg) {
  return lines.map((l) => `${bg}${l}${RESET}`).join("\n");
}

export function printUserBubble(text) {
  const content = String(text ?? "");
  const lines = content.split("\n");
  const rendered = lines.map((l, i) => {
    const prefix =
      i === 0 ? `${FG_USER_PREFIX} ● Tú: ${FG_WHITE}` : `${FG_USER_PREFIX} │ ${FG_WHITE}`;
    return `${prefix}${l} `;
  });
  // línea vacía antes/después para separación clara
  console.log("");
  console.log(wrapWithBg(rendered, BG_USER));
  console.log("");
}

export function printAgentBubble(text) {
  const content = String(text ?? "");
  const lines = content.split("\n");
  const rendered = lines.map((l, i) => {
    const prefix =
      i === 0 ? `${FG_AGENT_PREFIX} ◆ dscode: ${FG_WHITE}` : `${FG_AGENT_PREFIX} │ ${FG_WHITE}`;
    return `${prefix}${l} `;
  });
  console.log("");
  console.log(wrapWithBg(rendered, BG_AGENT));
  console.log("");
}

export function printToolCall(name, args) {
  const line = `${FG_TOOL_PREFIX}[tool] → ${name}(${args})${RESET}`;
  console.log(wrapWithBg([line], BG_TOOL));
}

export function printToolResult(name, preview) {
  const line = `${FG_DIM}${FG_TOOL_PREFIX}[tool] ← ${name}: ${preview}${RESET}`;
  console.log(wrapWithBg([line], BG_TOOL));
  console.log("");
}

export function printErrorBubble(text) {
  const BG_ERR = "\x1b[48;5;124m";
  console.log("");
  console.log(`${BG_ERR}\x1b[97m\x1b[1m ✖ Error: ${text} ${RESET}`);
  console.log("");
}
