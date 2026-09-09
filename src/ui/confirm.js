/**
 * Pide confirmación y/n al usuario directamente en la terminal, leyendo
 * teclas en modo raw. Diseñado para usarse DENTRO de la ejecución de una
 * tool (write_file sobre un archivo existente, run_command con un patrón
 * riesgoso), mientras el prompt principal (ui/promptLoop.js) está en su
 * ventana "busy" y por diseño ignora el teclado — así no hay dos
 * lectores de stdin compitiendo por las mismas teclas.
 */
export async function confirm(question, { defaultYes = false } = {}) {
  const suffix = defaultYes ? "[S/n]" : "[s/N]";
  process.stdout.write(`\n${question} ${suffix} `);

  return new Promise((resolve) => {
    const wasRaw = Boolean(process.stdin.isRaw);
    if (!wasRaw) process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const onData = (chunk) => {
      const key = chunk.toString();

      if (key === "\u0003") {
        // Ctrl+C durante una confirmación: se trata como "no", nunca
        // como salida abrupta del programa — evita cierres accidentales
        // a mitad de una operación potencialmente destructiva.
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
      // cualquier otra tecla: se ignora y se sigue esperando una respuesta válida
    };

    function cleanup() {
      process.stdin.off("data", onData);
      if (!wasRaw) process.stdin.setRawMode?.(false);
    }

    process.stdin.on("data", onData);
  });
}
