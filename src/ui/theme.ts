export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  blue: "\x1b[94m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  magenta: "\x1b[95m",
  red: "\x1b[91m",
  white: "\x1b[97m",
  gray: "\x1b[90m",
};

export function color(text: string, tone: keyof typeof ANSI): string {
  return `${ANSI[tone]}${text}${ANSI.reset}`;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function truncateLine(value: string, max = 92): string {
  const clean = stripAnsi(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
}
