import fs from "node:fs";
import { chromium } from "playwright";
import { SELECTORS } from "./selectors.js";
import { createLogger } from "../logger/logger.js";

export interface SessionConfig {
  chatUrl: string;
  headless: boolean;
  storageStatePath: string;
  responseTimeoutMs: number;
  chromiumExecutablePath?: string;
}
export interface Session {
  browser: import("playwright").Browser;
  context: import("playwright").BrowserContext;
  page: import("playwright").Page;
  historyLength: number;
  config: SessionConfig;
}

const log = createLogger("browser:session");

export async function createSession(config: SessionConfig): Promise<Session> {
  const { chatUrl, headless, storageStatePath, chromiumExecutablePath } = config;
  if (chromiumExecutablePath && !fs.existsSync(chromiumExecutablePath)) {
    throw new Error(
      `CHROMIUM_EXECUTABLE_PATH apunta a "${chromiumExecutablePath}" pero ese archivo no existe. Verifica la ruta.`
    );
  }
  const launchOptions: { headless: boolean; executablePath?: string } = { headless };
  if (chromiumExecutablePath) launchOptions.executablePath = chromiumExecutablePath;
  log.debug({ headless: launchOptions.headless }, "[chromium] Lanzando");
  const browser = await chromium.launch(launchOptions);
  let contextOptions: { storageState?: string } = {};
  if (fs.existsSync(storageStatePath)) contextOptions.storageState = storageStatePath;
  else log.warn({ storageStatePath }, "storageState no existe, se inicia sin sesión guardada");
  const context = await browser.newContext(contextOptions as never);
  const page = await context.newPage();
  await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  return { browser, context, page, historyLength: 0, config };
}

export async function closeSession(session: Session | null | undefined): Promise<void> {
  if (!session) return;
  if (session.context)
    await session.context.close().catch((e) => log.warn({ err: e }, "close context failed"));
  if (session.browser)
    await session.browser.close().catch((e) => log.warn({ err: e }, "close browser failed"));
}

async function checkForCloudflareChallenge(page: import("playwright").Page): Promise<void> {
  const overlay = page.locator(SELECTORS.cloudflareChallenge);
  const isVisible = await overlay.isVisible().catch((e) => {
    log.debug({ err: e }, "cloudflare check failed");
    return false;
  });
  if (isVisible)
    throw new Error(
      "Apareció el reto de Cloudflare (Turnstile) en DeepSeek. Si el navegador está visible (HEADLESS=false), resuélvelo manualmente y vuelve a intentar. Si está en headless, considera correr con HEADLESS=false."
    );
}

export async function sendMessage(
  session: Session,
  text: string,
  opts: { onSubmitted?: () => void } = {}
): Promise<string> {
  const { page } = session;
  await checkForCloudflareChallenge(page);
  const textarea = page.locator(SELECTORS.textarea).first();
  await textarea.waitFor({ state: "visible", timeout: 30000 });
  await textarea.click();
  await textarea.fill(text);
  const countBefore = await page.locator(SELECTORS.assistantMessage).count();
  let initialLastText = "";
  if (countBefore > 0) {
    try {
      initialLastText = await page
        .locator(SELECTORS.assistantMessage)
        .nth(countBefore - 1)
        .innerText();
    } catch (_e) {
      void _e;
    }
  }
  const sendButton = page.locator(SELECTORS.sendButton).first();
  const hasSendButton = (await sendButton.count()) > 0;
  if (hasSendButton) {
    await page
      .waitForFunction(
        (selector: string) => {
          const el = document.querySelector(selector);
          return el && !el.className.includes("disabled");
        },
        SELECTORS.sendButton,
        { timeout: 3000 }
      )
      .catch((e) => log.debug({ err: e }, "sendButton waitFunction timeout"));
    await sendButton.click();
  } else await textarea.press("Enter");
  if (opts.onSubmitted) opts.onSubmitted();
  await waitForResponseToFinish(
    page,
    countBefore,
    session.config.responseTimeoutMs,
    initialLastText
  );
  await checkForCloudflareChallenge(page);
  const messages = page.locator(SELECTORS.assistantMessage);
  const total = await messages.count();
  if (total === 0)
    throw new Error(
      "No se encontró ningún mensaje de asistente en la página. Revisa selectors.ts (assistantMessage) — probablemente cambió."
    );
  const lastMessage = messages.nth(total - 1);
  return await lastMessage.innerText();
}

export async function resumeReadResponse(session: Session): Promise<string> {
  const { page } = session;
  await checkForCloudflareChallenge(page);
  const messages = page.locator(SELECTORS.assistantMessage);
  const total = await messages.count();
  if (total === 0)
    throw new Error("resumeReadResponse: no hay ningún mensaje de asistente que leer todavía.");
  let initialLastText = "";
  if (total > 0) {
    try {
      initialLastText = await page
        .locator(SELECTORS.assistantMessage)
        .nth(total - 1)
        .innerText();
    } catch (_e) {
      void _e;
    }
  }
  await waitForResponseToFinish(page, total - 1, session.config.responseTimeoutMs, initialLastText);
  await checkForCloudflareChallenge(page);
  const finalTotal = await messages.count();
  const lastMessage = messages.nth(finalTotal - 1);
  return await lastMessage.innerText();
}

async function waitForResponseToFinish(
  page: import("playwright").Page,
  countBefore: number,
  responseTimeoutMs: number,
  initialLastText = ""
): Promise<void> {
  const stopButton = page.locator(SELECTORS.stopGeneratingButton).first();
  try {
    await stopButton.waitFor({ state: "visible", timeout: 5000 });
    await stopButton.waitFor({ state: "hidden", timeout: responseTimeoutMs });
    return;
  } catch (e) {
    log.debug({ err: e }, "stopButton polling fallback");
  }
  const start = Date.now();
  let lastLength = -1;
  let stableChecks = 0;
  let lastCount = countBefore;
  // initialLastText ya capturado ANTES del click (evita carrera si DeepSeek reusa div) — si no vino, capturar ahora como fallback
  if (!initialLastText && countBefore > 0) {
    try {
      initialLastText = await page
        .locator(SELECTORS.assistantMessage)
        .nth(countBefore - 1)
        .innerText();
    } catch (_e) {
      void _e;
    }
  }
  while (Date.now() - start < responseTimeoutMs) {
    await checkForCloudflareChallenge(page);
    const messages = page.locator(SELECTORS.assistantMessage);
    const count = await messages.count();
    if (count !== lastCount) {
      log.debug({ countBefore, count, lastLength }, "assistantMessage count changed");
      lastCount = count;
    }
    // Detectar mensaje nuevo, mutación o re-render (count puede bajar 3→2 si .ds-markdown es volátil)
    if (count > 0) {
      let text = "";
      try {
        text = await messages.nth(count - 1).innerText();
      } catch (_e) {
        void _e;
      }
      const isNewMessage = count !== countBefore;
      const isMutated = text !== initialLastText;
      // Si no hay cambio de count ni mutación y el texto ya era el inicial, no es respuesta nueva
      if (!isNewMessage && !isMutated) {
        // nada que hacer, seguir loop (evita falsos positivos con texto inicial idéntico)
      } else {
        const norm = text.replace(/\u00A0/g, " ");
        const hasToolCall =
          norm.includes("<<<TOOL_CALL>>>") && norm.includes("<<<END_TOOL_CALL>>>");
        log.debug(
          {
            count,
            textLen: text.length,
            lastLength,
            stableChecks,
            isNewMessage,
            isMutated,
            hasToolCall,
          },
          "polling assistantMessage"
        );
        // Para TOOL_CALL exigimos que el JSON interno sea parseable antes de darlo por listo, evitando truncado por streaming
        // Si el JSON no es válido (HTML con comillas/newlines sin escapar), aceptamos lenient igual para no truncar.
        if (text.length === lastLength && text.length > 0) {
          stableChecks++;
          if (hasToolCall && stableChecks >= 1) {
            // Validar que el interior sea JSON parseable o lenient-completo (evita devolver bloque a medio streamear)
            const inner = norm
              .slice(
                norm.indexOf("<<<TOOL_CALL>>>") + "<<<TOOL_CALL>>>".length,
                norm.indexOf("<<<END_TOOL_CALL>>>")
              )
              .trim()
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/```\s*$/i, "")
              .trim();
            try {
              JSON.parse(inner);
              return;
            } catch (_e) {
              void _e;
            }
            if (isLenientToolCallComplete(inner)) return;
            if (isLenientEditFileComplete(inner)) return;
            // si no parsea aún, seguir esperando (puede seguir streameando)
            if (stableChecks >= 3) return;
          } else if (stableChecks >= 3) return;
        } else if (text.length > 0) {
          stableChecks = 0;
          lastLength = text.length;
        }
      }
    }
    await page.waitForTimeout(800);
  }
  const finalCount = await page.locator(SELECTORS.assistantMessage).count();
  let fullLastText = "";
  try {
    if (finalCount > 0)
      fullLastText = await page
        .locator(SELECTORS.assistantMessage)
        .nth(finalCount - 1)
        .innerText();
  } catch (_e) {
    void _e;
  }
  const lastTextPreview = fullLastText.slice(0, 400);
  const trimmedFull = fullLastText.trim();
  // Si el último texto ya es un TOOL_CALL válido, no lanzar timeout — devolver como éxito (el caller lo parseará)
  // Usar fullLastText (no slice truncado) para no perder END marker de payloads largos con HTML
  if (fullLastText.includes("<<<TOOL_CALL>>>") && fullLastText.includes("<<<END_TOOL_CALL>>>")) {
    const normFull = fullLastText.replace(/\u00A0/g, " ");
    const innerFull = normFull
      .slice(
        normFull.indexOf("<<<TOOL_CALL>>>") + "<<<TOOL_CALL>>>".length,
        normFull.indexOf("<<<END_TOOL_CALL>>>")
      )
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    let looksComplete = false;
    try {
      JSON.parse(innerFull);
      looksComplete = true;
    } catch (_e) {
      void _e;
    }
    if (!looksComplete)
      looksComplete = isLenientToolCallComplete(innerFull) || isLenientEditFileComplete(innerFull);
    // Si no parece completo pero tiene ambos marcadores, igual retornar (evita timeout falso como el de klk.html con 480+ chars)
    if (looksComplete || fullLastText.includes("<<<END_TOOL_CALL>>>")) {
      log.warn(
        { countBefore, finalCount, lastText: lastTextPreview.slice(0, 200) },
        "waitForResponseToFinish timeout pero se detectó TOOL_CALL completo — retornando igual"
      );
      return;
    }
  }
  // Fallback plain-text estable: si hubo al menos 1 stabilidad y hay texto no vacío, retornar (cubre caso 3→2 tras edit_file OK)
  // Criterio: lastLength>0 implica 1 poll estable + trimmed>20 evita strings vacíos/cargando
  if (trimmedFull.length > 20 && lastLength > 0) {
    log.warn(
      { countBefore, finalCount, lastLength, stableChecks, preview: lastTextPreview.slice(0, 200) },
      "waitForResponseToFinish timeout pero plain-text estable detectado — retornando"
    );
    return;
  }
  // Último intento: si finalCount>0 y hay texto aunque no hubo estabilidad (ej. count drift 3→2), igual retornar para no perder la respuesta final del modelo
  if (trimmedFull.length > 20 && finalCount > 0) {
    log.warn(
      { countBefore, finalCount, lastText: lastTextPreview.slice(0, 200) },
      "waitForResponseToFinish timeout pero hay respuesta final — retornando igual (sin estabilidad)"
    );
    return;
  }
  throw new Error(
    `Timeout de ${responseTimeoutMs}ms esperando respuesta (countBefore=${countBefore} finalCount=${finalCount} lastLen=${lastLength} lastText="${lastTextPreview}"). Revisa selectors.ts o sube RESPONSE_TIMEOUT_MS en .env. Usa HEADLESS=false para ver el navegador.`
  );
}

function isLenientToolCallComplete(inner: string): boolean {
  // Considera completo si parece write_file con HTML crudo (comillas/newlines sin escapar) ya cerrado con }}
  if (!inner.includes('"name"') || !inner.includes('"path"')) return false;
  const trimmed = inner.trim();
  // Debe terminar con }} (cierre de arguments y outer) al menos
  if (!trimmed.endsWith("}") && !trimmed.endsWith('"}')) return false;
  // Heurística: si contiene "content" y tiene cierre de string + }} , lo damos por completo
  if (trimmed.includes('"content"') && /"content"\s*:\s*"[\s\S]*"\s*\}\s*\}\s*$/.test(trimmed))
    return true;
  // Para otros tools sin content, si tiene ambos cierres y empieza con {, damos por completo
  if (trimmed.startsWith("{") && trimmed.endsWith("}}")) return true;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return true;
  return false;
}

function isLenientEditFileComplete(inner: string): boolean {
  if (
    !inner.includes('"name"') ||
    !inner.includes('"old_string"') ||
    !inner.includes('"new_string"')
  )
    return false;
  const trimmed = inner.trim();
  if (!trimmed.endsWith("}") && !trimmed.endsWith('"}')) return false;
  if (
    trimmed.includes('"old_string"') &&
    trimmed.includes('"new_string"') &&
    /\}\s*\}\s*$/.test(trimmed)
  )
    return true;
  if (trimmed.startsWith("{") && trimmed.endsWith("}}")) return true;
  return false;
}

export async function startNewChat(session: Session): Promise<void> {
  const { page, config } = session;
  const newChatButton = page.locator(SELECTORS.newChatButton).first();
  if (await newChatButton.count()) {
    await newChatButton.click();
    await page.waitForTimeout(1000);
  } else await page.goto(config.chatUrl, { waitUntil: "domcontentloaded" });
  session.historyLength = 0;
}
