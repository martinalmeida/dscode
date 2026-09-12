import readline from "node:readline";
import type { RecoveryDecision } from "../domain/recovery/recoveryManager.js";

const labels: Record<RecoveryDecision, string> = {
  retry: "Reintentar la misma solicitud",
  new_chat: "Crear un nuevo chat y continuar",
  compact_new_chat: "Compactar contexto y crear un nuevo chat",
  pause: "Pausar la tarea",
  cancel: "Cancelar la tarea",
};

export async function askRecoveryDecision(opts: {
  code: string;
  message: string;
  options: RecoveryDecision[];
}): Promise<RecoveryDecision> {
  process.stdout.write(
    `\n\x1b[33m⚠ DeepSeek necesita atención\x1b[0m\n\nCausa: ${opts.message}\n\n¿Qué deseas hacer?\n`
  );
  opts.options.forEach((option, index) =>
    process.stdout.write(`  ${index + 1}. ${labels[option]}\n`)
  );
  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\nSelecciona una opción [1]: ", (value) => {
      rl.close();
      resolve(value.trim());
    });
  });
  const index = answer ? Number.parseInt(answer, 10) - 1 : 0;
  return opts.options[index] ?? opts.options[0]!;
}
