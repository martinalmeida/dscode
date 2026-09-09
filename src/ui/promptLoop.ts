import readline from "node:readline";
import { printUserBubble } from "./bubble.js";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  plan: "\x1b[36m",
  build: "\x1b[33m",
  green: "\x1b[32m",
};

export type PromptMode = "plan" | "build";

export function startPromptLoop(opts: {
  projectName: string;
  initialMode: PromptMode;
  onSubmit: (line: string, mode: PromptMode) => Promise<void>;
  onExit: () => Promise<void>;
}) {
  let mode: PromptMode = opts.initialMode;
  let buffer = "";
  let busy = false;

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) (process.stdin as unknown as { setRawMode: (v: boolean)=>void }).setRawMode(true);

  function promptLabel(): string {
    const color = mode === "plan" ? COLORS.plan : COLORS.build;
    const label = mode === "plan" ? "PLAN" : "BUILD";
    return `${color}${COLORS.bold}[${label}]${COLORS.reset} ${COLORS.dim}${opts.projectName}${COLORS.reset} > `;
  }
  function redraw(): void { process.stdout.write(`\r\x1b[K${promptLabel()}${buffer}`); }
  redraw();

  const onKeypress = async (str: string | undefined, key: { ctrl?: boolean; meta?: boolean; name?: string }) => {
    if (busy) return;
    if (key.ctrl && key.name === "c") { process.stdout.write("\n"); await opts.onExit(); return; }
    if (key.name === "tab") { mode = mode === "plan" ? "build" : "plan"; redraw(); return; }
    if (key.name === "return") {
      const line = buffer; buffer = ""; process.stdout.write("\n");
      if (!line.trim()) { redraw(); return; }
      printUserBubble(line);
      busy = true;
      try { await opts.onSubmit(line, mode); } finally { busy = false; redraw(); }
      return;
    }
    if (key.name === "backspace") { buffer = buffer.slice(0, -1); redraw(); return; }
    if (str && !key.ctrl && !key.meta) { buffer += str; redraw(); }
  };

  process.stdin.on("keypress", onKeypress);
  return {
    stop(): void {
      process.stdin.off("keypress", onKeypress);
      if (process.stdin.isTTY) (process.stdin as unknown as { setRawMode: (v:boolean)=>void }).setRawMode(false);
    },
    getMode: () => mode,
  };
}
