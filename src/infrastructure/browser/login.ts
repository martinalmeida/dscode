import path from "node:path";
import { chromium } from "playwright";
import { findChromium } from "./findChromium.js";
import { getEnvString } from "../../shared/env.js";
import { waitForChatReady } from "./session.js";

export async function runLogin(opts: {
  calibrate?: boolean;
  agentInstallDir: string;
}): Promise<void> {
  const { calibrate = false, agentInstallDir } = opts;
  const CHAT_URL = getEnvString("CHAT_URL", "https://chat.deepseek.com/");
  const STORAGE_STATE_PATH = path.resolve(
    agentInstallDir,
    getEnvString("STORAGE_STATE_PATH", "./storage-state.json")
  );
  const chromiumInfo = findChromium({
    agentInstallDir,
    explicitPath: getEnvString("CHROMIUM_EXECUTABLE_PATH") || undefined,
  });
  console.log(
    calibrate
      ? "Modo calibración: usa DevTools (F12) para revisar los selectores en src/infrastructure/browser/selectors.ts.\n"
      : "Modo login: inicia sesión manualmente en la ventana que se va a abrir.\n"
  );
  console.log(
    `Chromium: ${chromiumInfo.executablePath || "(propio de Playwright)"} — origen: ${chromiumInfo.source}`
  );
  const browser = await chromium.launch({
    headless: false,
    executablePath: chromiumInfo.executablePath,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(CHAT_URL);
  console.log(`Se abrió ${CHAT_URL}`);
  console.log("1. Inicia sesión con tu cuenta de DeepSeek normalmente (google/email/etc).");
  console.log("2. Espera a que cargue la pantalla del chat.");
  console.log('3. Si tienes "Pensamiento Profundo" o "Búsqueda inteligente" activados, apágalos.');
  if (calibrate) {
    console.log(
      "4. Abre DevTools (F12), manda un mensaje de prueba y anota los selectores reales."
    );
    console.log("5. Actualiza src/infrastructure/browser/selectors.ts con lo que encuentres.");
  }
  console.log(
    "\nCuando termines, vuelve aquí a la terminal y presiona ENTER para guardar la sesión..."
  );
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
  try {
    await waitForChatReady(page, 5000);
  } catch (err) {
    console.error(`\nNo se guardó la sesión: ${(err as Error).message}`);
    console.error(
      "Vuelve a ejecutar 'dscode login', inicia sesión y confirma cuando veas el chat."
    );
    await browser.close();
    return;
  }
  await context.storageState({ path: STORAGE_STATE_PATH });
  console.log(`\nSesión guardada en ${STORAGE_STATE_PATH}.`);
  console.log("Ya puedes correr 'dscode' desde cualquier proyecto sin volver a loguearte.");
  await browser.close();
}
