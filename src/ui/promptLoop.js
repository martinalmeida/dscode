import readline from "node:readline";
import { printUserBubble } from "./bubble.js";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  plan: "\x1b[36m", // cian
  build: "\x1b[33m", // amarillo
  green: "\x1b[32m",
};

/**
 * Loop de input propio (no usa readline.question()) para poder capturar
 * la tecla Tab SIN que envíe la línea — así se puede alternar entre modo
 * Plan y Build a mitad de escribir, igual que en OpenCode.
 *
 * Limitación consciente: es un editor de línea mínimo (soporta escritura,
 * backspace, Enter, Ctrl+C). No soporta mover el cursor con flechas ni
 * pegar texto multi-línea — para eso haría falta una librería de UI de
 * terminal completa, que se dejó fuera a propósito para mantener el
 * proyecto sin dependencias pesadas.
 */
export function startPromptLoop({ projectName, initialMode, onSubmit, onExit }) {
  let mode = initialMode; // "plan" | "build"
  let buffer = "";
  let busy = false; // mientras es true, se ignora el teclado (hay una tool corriendo, por ejemplo)

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  function promptLabel() {
    const color = mode === "plan" ? COLORS.plan : COLORS.build;
    const label = mode === "plan" ? "PLAN" : "BUILD";
    return `${color}${COLORS.bold}[${label}]${COLORS.reset} ${COLORS.dim}${projectName}${COLORS.reset} > `;
  }

  function redraw() {
    // \r vuelve al inicio de línea, \x1b[K borra hasta el final — así se
    // puede re-pintar el prompt completo sin dejar basura visual atrás.
    process.stdout.write(`\r\x1b[K${promptLabel()}${buffer}`);
  }

  redraw();

  const onKeypress = async (str, key) => {
    if (busy) return; // hay algo corriendo (una tool, una respuesta) — no leemos teclado

    if (key.ctrl && key.name === "c") {
      process.stdout.write("\n");
      await onExit();
      return;
    }

    if (key.name === "tab") {
      mode = mode === "plan" ? "build" : "plan";
      redraw();
      return;
    }

    if (key.name === "return") {
      const line = buffer;
      buffer = "";
      process.stdout.write("\n");

      if (!line.trim()) {
        redraw();
        return;
      }

      // Eco del usuario con fondo sutil separado (burbuja)
      printUserBubble(line);

      busy = true;
      try {
        await onSubmit(line, mode);
      } finally {
        busy = false;
        redraw();
      }
      return;
    }

    if (key.name === "backspace") {
      buffer = buffer.slice(0, -1);
      redraw();
      return;
    }

    // Caracteres imprimibles normales. Se ignoran combinaciones de control
    // no manejadas explícitamente arriba (flechas, Ctrl+otras teclas, etc.)
    // en vez de insertarlas como texto basura en el buffer.
    if (str && !key.ctrl && !key.meta) {
      buffer += str;
      redraw();
    }
  };

  process.stdin.on("keypress", onKeypress);

  return {
    stop() {
      process.stdin.off("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    },
    getMode: () => mode,
  };
}
