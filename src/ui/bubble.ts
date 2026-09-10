const RESET = "\x1b[0m";
const BG_USER = "\x1b[48;5;236m";
const BG_AGENT = "\x1b[48;5;235m";
const BG_TOOL = "\x1b[48;5;236m";
const FG_USER_PREFIX = "\x1b[94m\x1b[1m";
const FG_AGENT_PREFIX = "\x1b[95m\x1b[1m";
const FG_TOOL_PREFIX = "\x1b[33m";
const FG_WHITE = "\x1b[97m";
const FG_DIM = "\x1b[2m";

function wrapWithBg(lines: string[], bg: string): string {
  return lines.map((l) => `${bg}${l}${RESET}`).join("\n");
}

export function printUserBubble(text: string): void {
  const content = String(text ?? "");
  const lines = content.split("\n");
  const rendered = lines.map((l, i) => {
    const prefix =
      i === 0 ? `${FG_USER_PREFIX} ● Tú: ${FG_WHITE}` : `${FG_USER_PREFIX} │ ${FG_WHITE}`;
    return `${prefix}${l} `;
  });
  console.log("");
  console.log(wrapWithBg(rendered, BG_USER));
  console.log("");
}

export function printAgentBubble(text: string): void {
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

export function printToolCall(name: string, args: string): void {
  const line = `${FG_TOOL_PREFIX}[tool] → ${name}(${args})${RESET}`;
  console.log(wrapWithBg([line], BG_TOOL));
}

export function printToolResult(name: string, preview: string): void {
  const line = `${FG_DIM}${FG_TOOL_PREFIX}[tool] ← ${name}: ${preview}${RESET}`;
  console.log(wrapWithBg([line], BG_TOOL));
  console.log("");
}

export function printErrorBubble(text: string): void {
  const BG_ERR = "\x1b[48;5;124m";
  console.log("");
  console.log(`${BG_ERR}\x1b[97m\x1b[1m ✖ Error: ${text} ${RESET}`);
  console.log("");
}
