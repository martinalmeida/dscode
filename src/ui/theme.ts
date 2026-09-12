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

/**
 * Returns the number of terminal columns occupied by a string.
 * This intentionally uses a small dependency-free approximation suitable for
 * the CLI: ANSI sequences are ignored and common full-width / emoji codepoints
 * count as two columns.
 */
export function displayWidth(value: string): number {
  const text = stripAnsi(String(value ?? ""));
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2329 && code <= 0x232a) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    ) {
      width += 2;
    } else if (code >= 0x300 && code <= 0x36f) {
      // Combining mark.
      continue;
    } else {
      width += 1;
    }
  }
  return width;
}

export function terminalWidth(fallback = 100): number {
  const columns = process.stdout.columns;
  return Number.isFinite(columns) && columns > 20 ? columns : fallback;
}

/**
 * Wrap plain text to a terminal width without letting the terminal perform
 * implicit wrapping. Explicit newlines are preserved.
 */
export function wrapText(value: string, maxWidth: number): string[] {
  const width = Math.max(1, Math.floor(maxWidth));
  const source = String(value ?? "").replace(/\r\n/g, "\n");
  const sourceLines = source.split("\n");
  const result: string[] = [];

  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      result.push("");
      continue;
    }

    let current = "";
    let currentWidth = 0;
    for (const char of sourceLine) {
      const charWidth = displayWidth(char);
      if (current && currentWidth + charWidth > width) {
        result.push(current);
        current = "";
        currentWidth = 0;
      }
      current += char;
      currentWidth += charWidth;
    }
    result.push(current);
  }

  return result;
}

export function truncateLine(value: string, max = 92): string {
  const clean = stripAnsi(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
}
