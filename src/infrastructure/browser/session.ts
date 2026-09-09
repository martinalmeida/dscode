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
  log.info({ headless: launchOptions.headless }, "[chromium] Lanzando");
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
  while (Date.now() - start < responseTimeoutMs) {
    await checkForCloudflareChallenge(page);
    const messages = page.locator(SELECTORS.assistantMessage);
    const count = await messages.count();
    if (count > countBefore) {
      const text = await messages.nth(count - 1).innerText();
      if (text.length === lastLength) { stableChecks++; if (stableChecks >= 3) return; } else { stableChecks = 0; lastLength = text.length; }
    }
    await page.waitForTimeout(800);
  }
  throw new Error(`Timeout de ${responseTimeoutMs}ms esperando respuesta. Revisa selectors.ts o sube RESPONSE_TIMEOUT_MS en .env.`);
}

export async function startNewChat(session: Session): Promise<void> {
  const { page, config } = session;
  const newChatButton = page.locator(SELECTORS.newChatButton).first();
  if (await newChatButton.count()) { await newChatButton.click(); await page.waitForTimeout(1000); }
  else await page.goto(config.chatUrl, { waitUntil: "domcontentloaded" });
  session.historyLength = 0;
}
