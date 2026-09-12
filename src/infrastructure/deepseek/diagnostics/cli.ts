import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createDiagnosticSession as createBrowserDiagnosticSession,
  closeSession,
  type Session,
} from "../../browser/session.js";
import { DeepSeekDomInspector, type DeepSeekCapture } from "./domInspector.js";
import { compareDomFiles } from "./domDiff.js";
import { createLogger } from "../../logger/logger.js";
import { getEnvNumber, getEnvString } from "../../../shared/env.js";
import { findChromium } from "../../browser/findChromium.js";

const log = createLogger("deepseek:inspectCli");

export type InspectCommandOptions = {
  agentInstallDir: string;
  record: boolean;
  screenshots: boolean;
  outputDir?: string;
  diffFiles?: [string, string];
};

export async function runDeepSeekInspect(options: InspectCommandOptions): Promise<void> {
  if (options.diffFiles) {
    const result = await compareDomFiles(options.diffFiles[0], options.diffFiles[1]);
    console.log("\nDeepSeek DOM diff");
    console.log(`Antes: ${result.before}`);
    console.log(`Después: ${result.after}`);
    console.log(result.summary);
    return;
  }

  const outputDir = path.resolve(
    options.outputDir || path.join(process.cwd(), ".dscode", "deepseek-debug")
  );
  await fs.mkdir(outputDir, { recursive: true });
  const session = await createDiagnosticSession(options.agentInstallDir);
  const inspector = new DeepSeekDomInspector(session, {
    outputDir,
    screenshots: options.screenshots,
  });

  try {
    await inspector.prepare();
    const initial = await inspector.capture("initial");
    printCapture(initial, outputDir);

    if (!options.record) {
      console.log("\nCaptura inicial completada. Usa --record para mantener el inspector activo.");
      return;
    }

    await runRecordingSession(inspector, session.page, outputDir);
  } finally {
    await closeSession(session);
  }
}

async function runRecordingSession(
  inspector: DeepSeekDomInspector,
  page: Session["page"],
  outputDir: string
): Promise<void> {
  console.log("\nDeepSeek DOM Inspector activo.");
  console.log(
    "Usa la ventana de DeepSeek normalmente. El inspector captura automáticamente cambios del DOM."
  );
  console.log("Comandos: [c] capturar ahora  [q] salir");

  const rl = readline.createInterface({ input, output });
  let stopped = false;
  const watcher = setInterval(async () => {
    if (stopped || page.isClosed()) return;
    try {
      if (await inspector.hasMutations()) {
        const capture = await inspector.capture("mutation");
        console.log(`\n↻ Cambio DOM detectado: ${capture.captureId}`);
        printCapture(capture, outputDir);
      }
    } catch (err) {
      log.warn({ err }, "No se pudo capturar un cambio DOM");
    }
  }, 1000);

  try {
    while (!stopped) {
      const command = (await rl.question("\ndom-inspector> ")).trim().toLowerCase();
      if (command === "q" || command === "quit" || command === "exit") {
        stopped = true;
        break;
      }
      if (command === "c" || command === "capture" || command === "") {
        const capture = await inspector.capture("manual");
        printCapture(capture, outputDir);
        continue;
      }
      console.log("Comando desconocido. Usa c o q.");
    }
  } finally {
    stopped = true;
    clearInterval(watcher);
    rl.close();
  }
}

async function createDiagnosticSession(agentInstallDir: string): Promise<Session> {
  const executablePath = findChromium({
    agentInstallDir,
    explicitPath: getEnvString("CHROMIUM_EXECUTABLE_PATH") || undefined,
  }).executablePath;
  const storageStatePath = path.resolve(
    agentInstallDir,
    getEnvString("STORAGE_STATE_PATH", "./storage-state.json")
  );
  const session = await createBrowserDiagnosticSession({
    chatUrl: getEnvString("CHAT_URL", "https://chat.deepseek.com/"),
    headless: false,
    storageStatePath,
    responseTimeoutMs: getEnvNumber("RESPONSE_TIMEOUT_MS", 300000),
    chromiumExecutablePath: executablePath,
  });
  log.info("Sesión de diagnóstico DeepSeek creada en modo visible");
  return session;
}

function printCapture(capture: DeepSeekCapture, outputDir: string): void {
  const { state } = capture;
  console.log(`✓ Captura: ${capture.captureId}`);
  console.log(
    `  composer: ${state.composerCount} | buttons: ${state.buttons} | textareas: ${state.textareas} | contenteditable: ${state.contenteditables}`
  );
  console.log(
    `  links: ${state.links} | assistant: ${state.assistantLikeNodes} | user: ${state.userLikeNodes}`
  );
  console.log(
    `  visible text: ${state.visibleTextLength} chars | disabled buttons: ${state.disabledButtons}`
  );
  console.log(
    `  ui state: ${state.uiState} | generating: ${state.generating} | stop: ${state.stopButtonVisible} | send disabled: ${state.sendButtonDisabled}`
  );
  console.log(`  chat: ${state.chatId ?? "none"}`);
  console.log(`  signals: ${state.signals.length ? state.signals.join(", ") : "none"}`);
  if (state.activeErrorText) console.log(`  active error: ${state.activeErrorText}`);
  console.log(`  salida: ${outputDir}`);
}
