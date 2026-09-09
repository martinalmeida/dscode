import fs from "node:fs";
import { chromium } from "playwright";
import { SELECTORS } from "./selectors.js";

/**
 * A diferencia de la versión anterior (con servidor Express aparte y un
 * Map de sesiones por sessionId), aquí solo existe UNA sesión de
 * navegador por proceso — porque ahora todo el programa es un solo
 * proceso Node, no dos coordinados por HTTP. DeepSeekWebClient
 * (providers/webClient.js) crea y guarda esta sesión una sola vez.
 */
export async function createSession(config) {
  const {
    chatUrl,
    headless,
    storageStatePath,
    chromiumExecutablePath,
  } = config;

  if (chromiumExecutablePath && !fs.existsSync(chromiumExecutablePath)) {
    throw new Error(
      `CHROMIUM_EXECUTABLE_PATH apunta a "${chromiumExecutablePath}" pero ese archivo ` +
        "no existe. Verifica la ruta (debe ser absoluta y terminar en el binario " +
        '"chrome", no en la carpeta que lo contiene).'
    );
  }

  const launchOptions = { headless };
  if (chromiumExecutablePath) {
    launchOptions.executablePath = chromiumExecutablePath;
  }

  // Última confirmación, justo en el punto exacto donde se decide
  // visible/oculto — si esto dice "true" y AÚN ASÍ ves una ventana, el
  // problema ya no sería de configuración sino del propio binario de
  // Chromium ignorando el flag (rarísimo, pero al menos quedaría acotado).
  console.log(`[chromium] Lanzando con headless=${launchOptions.headless}`);

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();
  await page.goto(chatUrl, { waitUntil: "domcontentloaded" });

  return { browser, context, page, historyLength: 0, config };
}

export async function closeSession(session) {
  if (session?.context) {
    await session.context.close().catch(() => {});
  }
}

/**
 * DeepSeek usa un reto de Cloudflare Turnstile (overlay #cf-overlay) que
 * puede aparecer en cualquier momento. Playwright NO puede resolverlo
 * solo. Si aparece, lo mejor es frenar con un error claro.
 */
async function checkForCloudflareChallenge(page) {
  const overlay = page.locator(SELECTORS.cloudflareChallenge);
  const isVisible = await overlay.isVisible().catch(() => false);
  if (isVisible) {
    throw new Error(
      "Apareció el reto de Cloudflare (Turnstile) en DeepSeek. " +
        "Si el navegador está visible (HEADLESS=false), resuélvelo manualmente " +
        "y vuelve a intentar. Si está en headless, no hay forma automática de " +
        "resolverlo — considera correr con HEADLESS=false."
    );
  }
}

/**
 * Manda un mensaje de texto al chat ya abierto y espera la respuesta
 * completa del asistente, devolviendo el texto plano.
 *
 * onSubmitted (opcional): callback que se dispara justo después de que el
 * texto ya se escribió y se envió en el navegador (antes de esperar la
 * respuesta). Sirve para que el llamador marque ese mensaje como "ya
 * enviado" incluso si luego falla la espera de la respuesta — así un
 * reintento no vuelve a escribir el mismo texto por segunda vez.
 */
export async function sendMessage(session, text, { onSubmitted } = {}) {
  const { page } = session;

  await checkForCloudflareChallenge(page);

  const textarea = page.locator(SELECTORS.textarea).first();
  await textarea.waitFor({ state: "visible", timeout: 30000 });
  await textarea.click();
  await textarea.fill(text);

  const countBefore = await page.locator(SELECTORS.assistantMessage).count();

  const sendButton = page.locator(SELECTORS.sendButton).first();
  const hasSendButton = (await sendButton.count()) > 0;

  if (hasSendButton) {
    // Justo después de escribir, React puede tardar un instante en quitarle
    // el estado "disabled" al botón. Sin esta espera, el click puede caer
    // en una ventana donde el botón visualmente existe pero su onClick
    // todavía no hace nada.
    await page
      .waitForFunction(
        (selector) => {
          const el = document.querySelector(selector);
          return el && !el.className.includes("disabled");
        },
        SELECTORS.sendButton,
        { timeout: 3000 }
      )
      .catch(() => {});

    await sendButton.click();
  } else {
    await textarea.press("Enter");
  }

  // A partir de aquí el mensaje YA está enviado en el navegador.
  if (onSubmitted) onSubmitted();

  await waitForResponseToFinish(page, countBefore, session.config.responseTimeoutMs);

  await checkForCloudflareChallenge(page);

  const messages = page.locator(SELECTORS.assistantMessage);
  const total = await messages.count();
  if (total === 0) {
    throw new Error(
      "No se encontró ningún mensaje de asistente en la página. " +
        "Revisa selectors.js (assistantMessage) — probablemente cambió."
    );
  }

  const lastMessage = messages.nth(total - 1);
  return await lastMessage.innerText();
}

/**
 * Para usar después de un error en el que YA sabemos que el mensaje se
 * envió (gracias a onSubmitted) pero no llegamos a leer la respuesta.
 */
export async function resumeReadResponse(session) {
  const { page } = session;

  await checkForCloudflareChallenge(page);

  const messages = page.locator(SELECTORS.assistantMessage);
  const total = await messages.count();
  if (total === 0) {
    throw new Error(
      "resumeReadResponse: no hay ningún mensaje de asistente que leer todavía."
    );
  }

  await waitForResponseToFinish(page, total - 1, session.config.responseTimeoutMs);

  await checkForCloudflareChallenge(page);

  const finalTotal = await messages.count();
  const lastMessage = messages.nth(finalTotal - 1);
  return await lastMessage.innerText();
}

async function waitForResponseToFinish(page, countBefore, responseTimeoutMs) {
  const stopButton = page.locator(SELECTORS.stopGeneratingButton).first();

  try {
    await stopButton.waitFor({ state: "visible", timeout: 5000 });
    await stopButton.waitFor({ state: "hidden", timeout: responseTimeoutMs });
    return;
  } catch {
    // No apareció botón de stop (o el selector está mal): fallback por polling.
  }

  const start = Date.now();
  let lastLength = -1;
  let stableChecks = 0;

  while (Date.now() - start < responseTimeoutMs) {
    await checkForCloudflareChallenge(page);

    const messages = page.locator(SELECTORS.assistantMessage);
    const count = await messages.count();

    if (count > countBefore) {
      const text = await messages.nth(count - 1).innerText();
      if (text.length === lastLength) {
        stableChecks++;
        if (stableChecks >= 3) return;
      } else {
        stableChecks = 0;
        lastLength = text.length;
      }
    }

    await page.waitForTimeout(800);
  }

  throw new Error(
    `Timeout de ${responseTimeoutMs}ms esperando respuesta. ` +
      "Revisa selectors.js o sube RESPONSE_TIMEOUT_MS en .env."
  );
}

export async function startNewChat(session) {
  const { page, config } = session;
  const newChatButton = page.locator(SELECTORS.newChatButton).first();
  if (await newChatButton.count()) {
    await newChatButton.click();
    await page.waitForTimeout(1000);
  } else {
    await page.goto(config.chatUrl, { waitUntil: "domcontentloaded" });
  }
  session.historyLength = 0;
}
