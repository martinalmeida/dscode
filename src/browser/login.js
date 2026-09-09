import path from "node:path";
import { chromium } from "playwright";
import { getEnvString } from "../envUtils.js";
import { findChromium } from "./findChromium.js";

export async function runLogin({ calibrate = false, agentInstallDir } = {}) {
  const CHAT_URL = getEnvString("CHAT_URL", "https://chat.deepseek.com/");
  // Igual que en providers/index.js: SIEMPRE relativo a agentInstallDir,
  // nunca al cwd (que al usarse desde un proyecto sería una carpeta distinta).
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
      ? "Modo calibración: usa DevTools (F12) para revisar los selectores en src/browser/selectors.js.\n"
      : "Modo login: inicia sesión manualmente en la ventana que se va a abrir.\n"
  );
  console.log(`Chromium: ${chromiumInfo.executablePath || "(propio de Playwright)"} — origen: ${chromiumInfo.source}`);

  const browser = await chromium.launch({
    headless: false, // SIEMPRE visible aquí, es login manual
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
    console.log("4. Abre DevTools (F12), manda un mensaje de prueba y anota los selectores reales.");
    console.log("5. Actualiza src/browser/selectors.js con lo que encuentres.");
  }
  console.log("\nCuando termines, vuelve aquí a la terminal y presiona ENTER para guardar la sesión...");

  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
  });

  await context.storageState({ path: STORAGE_STATE_PATH });
  console.log(`\nSesión guardada en ${STORAGE_STATE_PATH}.`);
  console.log("Ya puedes correr 'dscode' desde cualquier proyecto sin volver a loguearte.");

  await browser.close();
}
