import readline from "node:readline";
import { printCommandHelp, printStatusLine, printUserBubble } from "./bubble.js";
import { color, displayWidth, terminalWidth, wrapText } from "./theme.js";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  plan: "\x1b[92m",
  build: "\x1b[95m",
};

export type PromptMode = "plan" | "build";

export function startPromptLoop(opts: {
  projectName: string;
  workspaceDir?: string;
  initialMode: PromptMode;
  onSubmit: (line: string, mode: PromptMode) => Promise<void>;
  onCommand?: (
    command: string,
    args: string,
    mode: PromptMode
  ) => Promise<"handled" | "mode:plan" | "mode:build" | "exit" | undefined>;
  onExit: () => Promise<void>;
}) {
  let mode: PromptMode = opts.initialMode;
  let buffer = "";
  let busy = false;
  let history: string[] = [];
  let historyIndex = -1;
  let renderedPromptLines = 0;

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    (process.stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  function promptLabel(): string {
    const colorCode = mode === "plan" ? COLORS.plan : COLORS.build;
    const label = mode === "plan" ? "PLAN" : "BUILD";
    return `${colorCode}${COLORS.bold}${label}${COLORS.reset} ${COLORS.dim}${opts.projectName}${COLORS.reset} ${color("›", "gray")} `;
  }

  function clearRenderedPrompt(): void {
    if (renderedPromptLines <= 0) return;

    // The old prompt may have occupied several terminal rows. Clear all of
    // them from bottom to top; clearing only the current row causes repeated
    // prompt prefixes when a long input wraps.
    process.stdout.write("\r\x1b[2K");
    for (let index = 1; index < renderedPromptLines; index += 1) {
      process.stdout.write("\x1b[1A\r\x1b[2K");
    }
    renderedPromptLines = 0;
  }

  function redraw(): void {
    clearRenderedPrompt();

    const columns = terminalWidth();
    const label = promptLabel();
    const labelWidth = displayWidth(label);
    const contentWidth = Math.max(1, columns - labelWidth);
    const bufferLines = wrapText(buffer, contentWidth);
    const lines = bufferLines.length > 0 ? bufferLines : [""];

    process.stdout.write(`${label}${lines[0] ?? ""}`);
    for (const line of lines.slice(1)) {
      process.stdout.write(`\n${" ".repeat(labelWidth)}${line}`);
    }
    renderedPromptLines = lines.length;
  }

  async function executeLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      redraw();
      return;
    }
    const commandMatch = trimmed.match(/^\/([^\s]+)(?:\s+(.*))?$/);
    if (commandMatch) {
      const command = commandMatch[1]!.toLowerCase();
      const args = (commandMatch[2] ?? "").trim();
      if (["exit", "quit", "salir"].includes(command)) {
        await opts.onExit();
        return;
      }
      if (command === "help") {
        printCommandHelp();
        redraw();
        return;
      }
      if (command === "clear") {
        process.stdout.write("\x1b[2J\x1b[H");
        redraw();
        return;
      }
      const result = await opts.onCommand?.(command, args, mode);
      if (result === "exit") {
        await opts.onExit();
        return;
      }
      if (result === "mode:plan") mode = "plan";
      if (result === "mode:build") mode = "build";
      if (result === "handled" || result) {
        redraw();
        return;
      }
      console.log(`${color("!", "yellow")} Comando desconocido. Usa ${color("/help", "cyan")}.`);
      redraw();
      return;
    }

    history = history.filter((item) => item !== trimmed);
    history.push(trimmed);
    if (history.length > 50) history.shift();
    historyIndex = -1;

    printUserBubble(trimmed);
    busy = true;
    try {
      await opts.onSubmit(trimmed, mode);
    } finally {
      busy = false;
      redraw();
    }
  }

  redraw();

  let fallbackRl: readline.Interface | null = null;
  if (!process.stdin.isTTY) {
    fallbackRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    fallbackRl.on("line", async (line: string) => {
      if (busy) return;
      await executeLine(line);
    });
    fallbackRl.on("close", async () => {
      await opts.onExit();
    });
  }

  const onKeypress = async (
    str: string | undefined,
    key: { ctrl?: boolean; meta?: boolean; name?: string }
  ) => {
    if (busy) return;
    if (key.ctrl && key.name === "c") {
      process.stdout.write("\n");
      await opts.onExit();
      return;
    }
    if (key.ctrl && key.name === "l") {
      process.stdout.write("\x1b[2J\x1b[H");
      redraw();
      return;
    }
    if (key.name === "tab") {
      mode = mode === "plan" ? "build" : "plan";
      redraw();
      return;
    }
    if (key.name === "up") {
      if (history.length === 0) return;
      historyIndex = Math.min(historyIndex + 1, history.length - 1);
      buffer = history[history.length - 1 - historyIndex] ?? "";
      redraw();
      return;
    }
    if (key.name === "down") {
      if (history.length === 0) return;
      historyIndex = Math.max(historyIndex - 1, -1);
      buffer = historyIndex === -1 ? "" : (history[history.length - 1 - historyIndex] ?? "");
      redraw();
      return;
    }
    if (key.name === "return") {
      const line = buffer;
      buffer = "";
      clearRenderedPrompt();
      process.stdout.write("\n");
      await executeLine(line);
      return;
    }
    if (key.name === "backspace") {
      buffer = buffer.slice(0, -1);
      redraw();
      return;
    }
    if (str && !key.ctrl && !key.meta) {
      buffer += str;
      redraw();
    }
  };

  if (process.stdin.isTTY) process.stdin.on("keypress", onKeypress);

  function pauseInput(): void {
    if (process.stdin.isTTY) {
      process.stdin.off("keypress", onKeypress);
      try {
        (process.stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode(false);
      } catch {
        // ignore terminal mode errors
      }
    }
    try {
      while (process.stdin.read() !== null) void 0;
    } catch {
      // ignore residual input errors
    }
  }

  function resumeInput(): void {
    if (process.stdin.isTTY) {
      process.stdin.on("keypress", onKeypress);
      readline.emitKeypressEvents(process.stdin);
      (process.stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
    }
    redraw();
  }

  return {
    stop(): void {
      if (process.stdin.isTTY) process.stdin.off("keypress", onKeypress);
      if (fallbackRl) fallbackRl.close();
      if (process.stdin.isTTY) {
        (process.stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode(false);
      }
      process.stdin.pause();
    },
    pauseInput,
    resumeInput,
    setBusy(v: boolean): void {
      busy = v;
    },
    getMode: () => mode,
    setMode(next: PromptMode): void {
      mode = next;
      redraw();
    },
    showStatus(): void {
      printStatusLine({
        mode,
        projectName: opts.projectName,
        workspace: opts.workspaceDir ?? process.cwd(),
      });
      redraw();
    },
  };
}
