import type { Locator, Page } from "playwright";
import { SELECTORS } from "../browser/selectors.js";

export type DeepSeekUiState =
  | "ready"
  | "generating"
  | "completed"
  | "auth_required"
  | "cloudflare"
  | "context_exhausted"
  | "error"
  | "unknown";

export type DeepSeekDomSnapshot = {
  url: string;
  chatId: string | null;
  composerVisible: boolean;
  composerCount: number;
  assistantCount: number;
  userCount: number;
  generating: boolean;
  sendButtonVisible: boolean;
  sendButtonDisabled: boolean;
  stopButtonVisible: boolean;
  contextExhausted: boolean;
  authRequired: boolean;
  cloudflare: boolean;
  errorText: string | null;
  state: DeepSeekUiState;
};

/**
 * Adapter for the observed DeepSeek Web DOM.
 *
 * Priority is given to semantic/stable DeepSeek markers found in real DOM
 * captures. Hashed CSS classes are deliberately used only as a fallback.
 */
export class DeepSeekDomAdapter {
  constructor(private readonly page: Page) {}

  composer(): Locator {
    return this.page.locator(SELECTORS.composer).first();
  }

  composerLocator(): Locator {
    return this.page.locator(SELECTORS.composer).first();
  }

  assistantMessages(): Locator {
    return this.page.locator(SELECTORS.assistantMessage);
  }

  userMessages(): Locator {
    return this.page.locator(SELECTORS.userMessage);
  }

  sendButton(): Locator {
    return this.page.locator(SELECTORS.sendButton).first();
  }

  stopButton(): Locator {
    return this.page.locator(SELECTORS.stopGeneratingButton).first();
  }

  newChatButton(): Locator {
    return this.page.locator(SELECTORS.newChatButton).first();
  }

  activeChatId(): string | null {
    const match = this.page.url().match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
    return match?.[1] ?? null;
  }

  async isGenerating(): Promise<boolean> {
    const stop = this.stopButton();
    if (await stop.count().catch(() => 0)) {
      return await stop.isVisible().catch(() => false);
    }
    return false;
  }

  async isContextExhausted(): Promise<boolean> {
    return this.hasVisibleErrorLikeText(SELECTORS.contextLimitPatterns);
  }

  async isAuthRequired(): Promise<boolean> {
    const url = this.page.url();
    if (/\/(login|signin|sign-in|auth)(\/|\?|$)/i.test(url)) return true;
    const body = await this.visibleBodyText();
    if (!/(sign in|log in|iniciar sesión|iniciar sesion|create account|crear cuenta)/i.test(body))
      return false;
    const composerVisible = await this.composer()
      .isVisible()
      .catch(() => false);
    return !composerVisible;
  }

  async isCloudflare(): Promise<boolean> {
    const loc = this.page.locator(SELECTORS.cloudflareChallenge);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      if (
        await loc
          .nth(i)
          .isVisible()
          .catch(() => false)
      )
        return true;
    }
    const body = await this.visibleBodyText();
    return /verify you are human|one more step before you proceed|turnstile/i.test(body);
  }

  async activeErrorText(): Promise<string | null> {
    // Only inspect containers that semantically represent an alert/notification
    // or a known DeepSeek notification area. Never classify arbitrary chat titles.
    const selectors = [
      '[role="alert"]',
      '[role="status"]',
      ".ds-notification-container",
      '[class*="notification" i]',
      '[class*="toast" i]',
      '[class*="error-message" i]',
      '[class*="errorMessage" i]',
    ];
    const texts: string[] = [];
    for (const selector of selectors) {
      const loc = this.page.locator(selector);
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = loc.nth(i);
        if (!(await item.isVisible().catch(() => false))) continue;
        const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (text) texts.push(text.slice(0, 1000));
      }
    }
    const merged = texts.join(" | ");
    if (!merged) return null;
    if (
      !/(error|something went wrong|try again|intenta de nuevo|fall[oó]|no se pudo|failed|unavailable|too long|context)/i.test(
        merged
      )
    )
      return null;
    return merged;
  }

  async snapshot(): Promise<DeepSeekDomSnapshot> {
    const composer = this.composer();
    const send = this.sendButton();
    const stop = this.stopButton();
    const [
      composerCount,
      composerVisible,
      assistantCount,
      userCount,
      generating,
      sendCount,
      stopCount,
      contextExhausted,
      authRequired,
      cloudflare,
      errorText,
    ] = await Promise.all([
      this.page
        .locator(SELECTORS.composer)
        .count()
        .catch(() => 0),
      composer.isVisible().catch(() => false),
      this.assistantMessages()
        .count()
        .catch(() => 0),
      this.userMessages()
        .count()
        .catch(() => 0),
      this.isGenerating(),
      send.count().catch(() => 0),
      stop.count().catch(() => 0),
      this.isContextExhausted(),
      this.isAuthRequired(),
      this.isCloudflare(),
      this.activeErrorText(),
    ]);

    const sendVisible = sendCount > 0 && (await send.isVisible().catch(() => false));
    const sendDisabled = sendVisible && (await this.isDisabled(send));
    let state: DeepSeekUiState = "unknown";
    if (cloudflare) state = "cloudflare";
    else if (authRequired) state = "auth_required";
    else if (contextExhausted) state = "context_exhausted";
    else if (errorText) state = "error";
    else if (generating || stopCount > 0) state = "generating";
    else if (assistantCount > 0) state = "completed";
    else if (composerVisible) state = "ready";

    return {
      url: this.page.url(),
      chatId: this.activeChatId(),
      composerVisible,
      composerCount,
      assistantCount,
      userCount,
      generating,
      sendButtonVisible: sendVisible,
      sendButtonDisabled: sendDisabled,
      stopButtonVisible: stopCount > 0 && (await stop.isVisible().catch(() => false)),
      contextExhausted,
      authRequired,
      cloudflare,
      errorText,
      state,
    };
  }

  async waitUntilReady(timeoutMs = 12000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await this.snapshot();
      if (snapshot.authRequired)
        throw codedError("AUTH_REQUIRED", "La sesión de DeepSeek no está autenticada.");
      if (snapshot.cloudflare)
        throw codedError(
          "CLOUDFLARE_CHALLENGE",
          "DeepSeek requiere completar una verificación de Cloudflare/Turnstile."
        );
      if (snapshot.contextExhausted)
        throw codedError(
          "CONTEXT_EXHAUSTED",
          "DeepSeek alcanzó el límite de contexto de este chat."
        );
      if (snapshot.composerVisible) return;
      await this.page.waitForTimeout(250);
    }
    throw codedError(
      "COMPOSER_NOT_FOUND",
      `No se encontró el composer de DeepSeek después de ${timeoutMs} ms.`
    );
  }

  async lastAssistantText(): Promise<string> {
    const messages = this.assistantMessages();
    const count = await messages.count();
    if (count === 0) return "";
    return messages
      .nth(count - 1)
      .innerText()
      .catch(() => "");
  }

  async assistantCount(): Promise<number> {
    return this.assistantMessages()
      .count()
      .catch(() => 0);
  }

  async userCount(): Promise<number> {
    return this.userMessages()
      .count()
      .catch(() => 0);
  }

  async hasVisibleErrorLikeText(patterns: readonly RegExp[]): Promise<boolean> {
    const selectors = [
      '[role="alert"]',
      '[role="status"]',
      ".ds-notification-container",
      '[class*="notification" i]',
      '[class*="toast" i]',
    ];
    for (const selector of selectors) {
      const loc = this.page.locator(selector);
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = loc.nth(i);
        if (!(await item.isVisible().catch(() => false))) continue;
        const text = await item.innerText().catch(() => "");
        if (patterns.some((pattern) => pattern.test(text))) return true;
      }
    }
    // Context-limit messages can sometimes be rendered directly by the chat UI;
    // only use precise context phrases here, never the word "error" alone.
    const body = await this.visibleBodyText();
    return patterns.some((pattern) => pattern.test(body));
  }

  private async visibleBodyText(): Promise<string> {
    return this.page
      .locator("body")
      .innerText({ timeout: 1500 })
      .catch(() => "");
  }

  private async isDisabled(locator: Locator): Promise<boolean> {
    return locator
      .evaluate((el) => {
        const html = el as HTMLElement & { disabled?: boolean };
        return (
          Boolean(html.disabled) ||
          el.getAttribute("aria-disabled") === "true" ||
          /(^|\s)ds-button--disabled(\s|$)/.test(el.className)
        );
      })
      .catch(() => true);
  }
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
