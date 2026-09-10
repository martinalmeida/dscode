export async function confirm(question: string, { defaultYes = false } = {}): Promise<boolean> {
  const suffix = defaultYes ? "[S/n]" : "[s/N]";
  // limpiar línea del spinner antes de preguntar
  process.stdout.write(`\r\x1b[K\n${question} ${suffix} `);

  return new Promise((resolve) => {
    // Drenar buffer residual (el "\n" del "si" previo o del prompt)
    try { while (process.stdin.read() !== null) void 0; } catch (_e) { void _e; }
    // Asegurar modo raw para leer 's'/'n' sin Enter
    const wasRaw = Boolean((process.stdin as unknown as { isRaw?: boolean }).isRaw);
    if (!wasRaw) (process.stdin as unknown as { setRawMode?: (v: boolean) => void }).setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let settled = false;
    const onData = (chunk: string | Buffer): void => {
      if (settled) return;
      const key = chunk.toString();
      // Puede llegar "s\n" junto; inspeccionar char por char
      for (const ch of key) {
        if (ch === "\u0003") {
          settled = true; cleanup(); console.log("n (cancelado)"); resolve(false); return;
        }
        if (ch === "\r" || ch === "\n") {
          settled = true; cleanup(); console.log(defaultYes ? "s" : "n"); resolve(defaultYes); return;
        }
        const lower = ch.toLowerCase();
        if (lower === "s" || lower === "y") {
          settled = true; cleanup(); console.log("s"); resolve(true); return;
        }
        if (lower === "n") {
          settled = true; cleanup(); console.log("n"); resolve(false); return;
        }
      }
    };

    function cleanup(): void {
      process.stdin.off("data", onData as never);
      // No restaurar a !raw aquí: promptLoop resumeInput lo hará
      // Pero si entramos sin raw, dejarlo como estaba para no dejar terminal colgada
      if (!wasRaw) (process.stdin as unknown as { setRawMode?: (v: boolean) => void }).setRawMode?.(false);
    }

    process.stdin.on("data", onData as never);
  });
}
