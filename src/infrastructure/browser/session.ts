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
export interface Session { browser: import("playwright").Browser; context: import("playwright").BrowserContext; page: import("playwright").Page; historyLength: number; config: SessionConfig; }

const log = createLogger("browser:session");

export async function createSession(config: SessionConfig): Promise<Session> {
  const { chatUrl, headless, storageStatePath, chromiumExecutablePath } = config;
  if (chromiumExecutablePath && !fs.existsSync(chromiumExecutablePath)) {
    throw new Error(`CHROMIUM_EXECUTABLE_PATH apunta a "${chromiumExecutablePath}" pero ese archivo no existe. Verifica la ruta.`);
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
  if (session.context) await session.context.close().catch((e) => log.warn({ err: e }, "close context failed"));
  if (session.browser) await session.browser.close().catch((e) => log.warn({ err: e }, "close browser failed"));
}

async function checkForCloudflareChallenge(page: import("playwright").Page): Promise<void> {
  const overlay = page.locator(SELECTORS.cloudflareChallenge);
  const isVisible = await overlay.isVisible().catch((e) => {
    log.debug({ err: e }, "cloudflare check failed");
    return false;
  });
  if (isVisible) throw new Error("Apareció el reto de Cloudflare (Turnstile) en DeepSeek. Si el navegador está visible (HEADLESS=false), resuélvelo manualmente y vuelve a intentar. Si está en headless, considera correr con HEADLESS=false.");
}

export async function sendMessage(session: Session, text: string, opts: { onSubmitted?: () => void } = {}): Promise<string> {
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
  await waitForResponseToFinish(page, countBefore, session.config.responseTimeoutMs);
  await checkForCloudflareChallenge(page);
  const messages = page.locator(SELECTORS.assistantMessage);
  const total = await messages.count();
  if (total === 0) throw new Error("No se encontró ningún mensaje de asistente en la página. Revisa selectors.ts (assistantMessage) — probablemente cambió.");
  const lastMessage = messages.nth(total - 1);
  return await lastMessage.innerText();
}

export async function resumeReadResponse(session: Session): Promise<string> {
  const { page } = session;
  await checkForCloudflareChallenge(page);
  const messages = page.locator(SELECTORS.assistantMessage);
  const total = await messages.count();
  if (total === 0) throw new Error("resumeReadResponse: no hay ningún mensaje de asistente que leer todavía.");
  await waitForResponseToFinish(page, total - 1, session.config.responseTimeoutMs);
  await checkForCloudflareChallenge(page);
  const finalTotal = await messages.count();
  const lastMessage = messages.nth(finalTotal - 1);
  return await lastMessage.innerText();
}

async function waitForResponseToFinish(page: import("playwright").Page, countBefore: number, responseTimeoutMs: number): Promise<void> {
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
  let initialLastText = "";
  if (countBefore > 0) {
    try { initialLastText = await page.locator(SELECTORS.assistantMessage).nth(countBefore - 1).innerText(); } catch (_e) { void _e; }
  }
  while (Date.now() - start < responseTimeoutMs) {
    await checkForCloudflareChallenge(page);
    const messages = page.locator(SELECTORS.assistantMessage);
    const count = await messages.count();
    if (count !== lastCount) {
      log.debug({ countBefore, count, lastLength }, "assistantMessage count changed");
      lastCount = count;
    }
    // Detectar tanto mensaje nuevo (count > countBefore) como mutación del último (DeepSeek reusa el div y edita el texto)
    if (count > countBefore || (count > 0 && count === countBefore)) {
      let text = "";
      try { text = await messages.nth(count - 1).innerText(); } catch (_e) { void _e; }
      const isNewMessage = count > countBefore;
      const isMutated = count === countBefore && text !== initialLastText;
      // Si no hay mutación ni mensaje nuevo, no es respuesta nueva → seguir esperando
      if (!isNewMessage && !isMutated) {
        // nada que hacer, seguir loop
      } else {
        const norm = text.replace(/\u00A0/g, " ");
        const hasToolCall = norm.includes("<<<TOOL_CALL>>>") && norm.includes("<<<END_TOOL_CALL>>>");
        log.debug({ count, textLen: text.length, lastLength, stableChecks, isNewMessage, isMutated, hasToolCall }, "polling assistantMessage");
        // Para TOOL_CALL exigimos que el JSON interno sea parseable antes de darlo por listo, evitando truncado por streaming
        // Si el JSON no es válido (HTML con comillas/newlines sin escapar), aceptamos lenient igual para no truncar.
        if (text.length === lastLength && text.length > 0) {
          stableChecks++;
          if (hasToolCall && stableChecks >= 1) {
            // Validar que el interior sea JSON parseable o lenient-completo (evita devolver bloque a medio streamear)
            const inner = norm.slice(norm.indexOf("<<<TOOL_CALL>>>") + "<<<TOOL_CALL>>>".length, norm.indexOf("<<<END_TOOL_CALL>>>")).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
            try { JSON.parse(inner); return; } catch (_e) { void _e; }
            if (isLenientToolCallComplete(inner)) return;
            // si no parsea aún, seguir esperando (puede seguir streameando)
            if (stableChecks >= 3) return;
          } else if (stableChecks >= 3) return;
        } else if (text.length > 0) { stableChecks = 0; lastLength = text.length; }
      }
    }
    await page.waitForTimeout(800);
  }
  const finalCount = await page.locator(SELECTORS.assistantMessage).count();
  let lastText = "";
  try { if (finalCount > 0) lastText = (await page.locator(SELECTORS.assistantMessage).nth(finalCount - 1).innerText()).slice(0, 400); } catch (_e) { void _e; }
  // Si el último texto ya es un TOOL_CALL válido, no lanzar timeout — devolver como éxito (el caller lo parseará)
  if (lastText.includes("<<<TOOL_CALL>>>") && lastText.includes("<<<END_TOOL_CALL>>>")) {
    log.warn({ countBefore, finalCount, lastText: lastText.slice(0, 200) }, "waitForResponseToFinish timeout pero se detectó TOOL_CALL completo — retornando igual");
    return;
  }
  throw new Error(`Timeout de ${responseTimeoutMs}ms esperando respuesta (countBefore=${countBefore} finalCount=${finalCount} lastLen=${lastLength} lastText="${lastText}"). Revisa selectors.ts o sube RESPONSE_TIMEOUT_MS en .env. Usa HEADLESS=false para ver el navegador.`);
}

function isLenientToolCallComplete(inner: string): boolean {
  // Considera completo si parece write_file con HTML crudo (comillas/newlines sin escapar) ya cerrado con }}
  if (!inner.includes('"name"') || !inner.includes('"path"')) return false;
  const trimmed = inner.trim();
  // Debe terminar con }} (cierre de arguments y outer) al menos
  if (!trimmed.endsWith("}") && !trimmed.endsWith('"}')) return false;
  // Heurística: si contiene "content" y tiene cierre de string + }} , lo damos por completo
  if (trimmed.includes('"content"') && /"content"\s*:\s*"[\s\S]*"\s*\}\s*\}\s*$/.test(trimmed)) return true;
  // Para otros tools sin content, si tiene ambos cierres y empieza con {, damos por completo
  if (trimmed.startsWith("{") && trimmed.endsWith("}}")) return true;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return true;
  return false;
}

export async function startNewChat(session: Session): Promise<void> {
  const { page, config } = session;
  const newChatButton = page.locator(SELECTORS.newChatButton).first();
  if (await newChatButton.count()) { await newChatButton.click(); await page.waitForTimeout(1000); }
  else await page.goto(config.chatUrl, { waitUntil: "domcontentloaded" });
  session.historyLength = 0;
}
