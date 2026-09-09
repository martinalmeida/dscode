export async function confirm(question: string, { defaultYes = false } = {}): Promise<boolean> {
  const suffix = defaultYes ? "[S/n]" : "[s/N]";
  process.stdout.write(`\n${question} ${suffix} `);

  return new Promise((resolve) => {
    const wasRaw = Boolean((process.stdin as unknown as { isRaw?: boolean }).isRaw);
    if (!wasRaw) (process.stdin as unknown as { setRawMode?: (v: boolean) => void }).setRawMode?.(true);
    process.stdin.resume();

    const onData = (chunk: Buffer): void => {
      const key = chunk.toString();

      if (key === "\u0003") {
        cleanup();
        console.log("n (cancelado)");
        resolve(false);
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        console.log(defaultYes ? "s" : "n");
        resolve(defaultYes);
        return;
      }
      const lower = key.toLowerCase();
      if (lower === "s" || lower === "y") {
        cleanup();
        console.log("s");
        resolve(true);
        return;
      }
      if (lower === "n") {
        cleanup();
        console.log("n");
        resolve(false);
        return;
      }
    };

    function cleanup(): void {
      process.stdin.off("data", onData);
      if (!wasRaw) (process.stdin as unknown as { setRawMode?: (v: boolean) => void }).setRawMode?.(false);
    }

    process.stdin.on("data", onData);
  });
}
