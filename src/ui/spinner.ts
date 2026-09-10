const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

export function createSpinner() {
  let timer: NodeJS.Timeout | null = null;
  let tick = 0;
  let currentMsg = "Consultando DeepSeek";

  function render(): void {
    const dots = ".".repeat((tick % 4) + 1);
    const padded = (currentMsg + dots).padEnd(currentMsg.length + 4, " ");
    process.stdout.write(`\r\x1b[K${CYAN}⠋ ${padded}${RESET}`);
    tick++;
  }

  return {
    start(msg = "Consultando DeepSeek"): void {
      if (!process.stdout.isTTY) return;
      currentMsg = msg;
      tick = 0;
      render();
      if (timer) clearInterval(timer);
      timer = setInterval(render, 220);
    },
    setMessage(msg: string): void {
      currentMsg = msg;
    },
    pause(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        process.stdout.write("\r\x1b[K");
      }
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
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write("\r\x1b[K");
    },
  };
}
