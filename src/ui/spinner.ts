import { color } from "./theme.js";

export function createSpinner() {
  let timer: NodeJS.Timeout | null = null;
  let tick = 0;
  let currentMsg = "Pensando";

  function render(): void {
    if (!process.stdout.isTTY) return;
    const frames = ["·  ", "·· ", "···", " ··", "  ·", " ··"];
    const frame = frames[tick % frames.length];
    process.stdout.write(`\r\x1b[K${color("  " + frame, "cyan")} ${currentMsg}`);
    tick++;
  }

  function clear(): void {
    process.stdout.write("\r\x1b[K");
  }

  return {
    start(msg = "Pensando"): void {
      currentMsg = msg;
      tick = 0;
      if (!process.stdout.isTTY) return;
      render();
      if (timer) clearInterval(timer);
      timer = setInterval(render, 220);
    },
    setMessage(msg: string): void {
      currentMsg = msg;
      render();
    },
    pause(): void {
      if (timer) clearInterval(timer);
      timer = null;
      clear();
    },
    resume(msg?: string): void {
      if (msg) currentMsg = msg;
      if (!process.stdout.isTTY) return;
      if (timer) clearInterval(timer);
      tick = 0;
      render();
      timer = setInterval(render, 220);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
      clear();
    },
  };
}
