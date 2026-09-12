import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { Session } from "../../browser/session.js";
import { createLogger } from "../../logger/logger.js";
import { DeepSeekDomAdapter, type DeepSeekUiState } from "../domAdapter.js";

const log = createLogger("deepseek:domInspector");

export type DeepSeekCapture = {
  captureId: string;
  timestamp: string;
  url: string;
  title: string;
  bodyText: string;
  html: string;
  screenshotPath?: string;
  metadataPath: string;
  htmlPath: string;
  interactivePath: string;
  bodyTextPath: string;
  state: {
    authenticatedSignals: number;
    composerCount: number;
    buttons: number;
    textareas: number;
    contenteditables: number;
    links: number;
    assistantLikeNodes: number;
    userLikeNodes: number;
    disabledButtons: number;
    visibleTextLength: number;
    generating: boolean;
    stopButtonVisible: boolean;
    sendButtonDisabled: boolean;
    chatId: string | null;
    uiState: DeepSeekUiState;
    activeErrorText: string | null;
    signals: string[];
  };
};

export type DomInspectorOptions = {
  outputDir: string;
  screenshots: boolean;
};

type InteractiveElement = {
  tag: string;
  role: string | null;
  ariaLabel: string | null;
  ariaDisabled: string | null;
  title: string | null;
  name: string | null;
  type: string | null;
  placeholder: string | null;
  testId: string | null;
  id: string | null;
  className: string | null;
  text: string;
  visible: boolean;
  disabled: boolean;
};

type DomState = {
  authenticatedSignals: number;
  composerCount: number;
  buttons: number;
  textareas: number;
  contenteditables: number;
  links: number;
  assistantLikeNodes: number;
  userLikeNodes: number;
  disabledButtons: number;
  visibleTextLength: number;
  generating: boolean;
  stopButtonVisible: boolean;
  sendButtonDisabled: boolean;
  chatId: string | null;
  uiState: DeepSeekUiState;
  activeErrorText: string | null;
  signals: string[];
};

const OBSERVER_KEY = "__dscodeDeepSeekInspector";

export class DeepSeekDomInspector {
  private readonly session: Session;
  private readonly options: DomInspectorOptions;
  private observerInstalled = false;
  private lastMutationCount = 0;

  constructor(session: Session, options: DomInspectorOptions) {
    this.session = session;
    this.options = options;
  }

  async prepare(): Promise<void> {
    await fs.mkdir(this.options.outputDir, { recursive: true });
    await this.installMutationObserver();
  }

  async installMutationObserver(): Promise<void> {
    const page = this.session.page;
    await page.evaluate((key) => {
      const target = window as unknown as Record<string, unknown>;
      if (target[key]) return;
      const state = { count: 0, lastAt: null as string | null, samples: [] as string[] };
      const observer = new MutationObserver((mutations) => {
        state.count += mutations.length;
        state.lastAt = new Date().toISOString();
        for (const mutation of mutations.slice(0, 10)) {
          const element = mutation.target instanceof Element ? mutation.target : null;
          const sample = element?.outerHTML?.slice(0, 500) ?? mutation.type;
          state.samples.push(`${mutation.type}: ${sample}`);
        }
        if (state.samples.length > 50) state.samples.splice(0, state.samples.length - 50);
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      target[key] = { state, observer };
    }, OBSERVER_KEY);
    this.observerInstalled = true;
  }

  async getMutationState(): Promise<{ count: number; lastAt: string | null; samples: string[] }> {
    return this.session.page
      .evaluate((key) => {
        const target = window as unknown as Record<string, unknown>;
        const holder = target[key] as
          { state?: { count: number; lastAt: string | null; samples: string[] } } | undefined;
        return holder?.state ?? { count: 0, lastAt: null, samples: [] };
      }, OBSERVER_KEY)
      .catch(() => ({ count: 0, lastAt: null, samples: [] }));
  }

  hasMutations(): Promise<boolean> {
    return this.getMutationState().then((state) => state.count !== this.lastMutationCount);
  }

  async capture(label?: string): Promise<DeepSeekCapture> {
    const page = this.session.page;
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const safeLabel = sanitizeFilePart(label || "snapshot");
    const captureId = `${stamp}-${safeLabel}`;
    const base = path.join(this.options.outputDir, captureId);
    const htmlPath = `${base}.html`;
    const metadataPath = `${base}.json`;
    const interactivePath = `${base}.interactive.json`;
    const bodyTextPath = `${base}.txt`;
    const screenshotPath = this.options.screenshots ? `${base}.png` : undefined;

    const [html, bodyText, title, url, state, interactive] = await Promise.all([
      page.content(),
      page
        .locator("body")
        .innerText({ timeout: 5000 })
        .catch(() => ""),
      page.title().catch(() => ""),
      Promise.resolve(page.url()),
      this.collectState(page),
      this.collectInteractive(page),
    ]);

    await fs.writeFile(htmlPath, html, "utf8");
    await fs.writeFile(interactivePath, JSON.stringify(interactive, null, 2), "utf8");
    await fs.writeFile(bodyTextPath, bodyText, "utf8");
    if (screenshotPath)
      await page
        .screenshot({ path: screenshotPath, fullPage: true })
        .catch((err) => log.warn({ err }, "No se pudo guardar screenshot"));

    const mutations = await this.getMutationState();
    this.lastMutationCount = mutations.count;
    const metadata = {
      captureId,
      timestamp: now.toISOString(),
      url,
      title,
      chatUrl: this.session.config.chatUrl,
      state,
      mutationObserver: mutations,
      files: {
        html: path.basename(htmlPath),
        interactive: path.basename(interactivePath),
        bodyText: path.basename(bodyTextPath),
        screenshot: screenshotPath ? path.basename(screenshotPath) : null,
      },
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const result: DeepSeekCapture = {
      captureId,
      timestamp: now.toISOString(),
      url,
      title,
      bodyText,
      html,
      screenshotPath,
      metadataPath,
      htmlPath,
      interactivePath,
      bodyTextPath,
      state,
    };
    log.info({ captureId, state, outputDir: this.options.outputDir }, "DeepSeek DOM capturado");
    return result;
  }

  async watch(
    intervalMs = 1000,
    durationMs = 0,
    onCapture?: (capture: DeepSeekCapture) => Promise<void>
  ): Promise<void> {
    if (!this.observerInstalled) await this.installMutationObserver();
    const started = Date.now();
    while (durationMs <= 0 || Date.now() - started < durationMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (!(await this.hasMutations())) continue;
      const capture = await this.capture("mutation");
      if (onCapture) await onCapture(capture);
    }
  }

  private async collectState(page: Page): Promise<DomState> {
    const adapter = new DeepSeekDomAdapter(page);
    const snapshot = await adapter.snapshot();
    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "");
    const buttons = await page
      .locator("button, [role=button]")
      .count()
      .catch(() => 0);
    const textareas = await page
      .locator("textarea")
      .count()
      .catch(() => 0);
    const contenteditables = await page
      .locator('[contenteditable="true"]')
      .count()
      .catch(() => 0);
    const links = await page
      .locator("a")
      .count()
      .catch(() => 0);
    const disabledButtons = await page
      .locator("button, [role=button]")
      .evaluateAll(
        (els) =>
          els.filter((el) => {
            const html = el as HTMLElement & { disabled?: boolean };
            return (
              Boolean(html.disabled) ||
              el.getAttribute("aria-disabled") === "true" ||
              /(^|\s)ds-button--disabled(\s|$)/.test(el.className)
            );
          }).length
      )
      .catch(() => 0);
    const authText =
      bodyText.match(
        /sign in|log in|login|iniciar sesión|iniciar sesion|create account|crear cuenta/gi
      ) ?? [];
    const signals: string[] = [];
    if (authText.length > 0 && !snapshot.composerVisible) signals.push("AUTH_UI_SIGNAL");
    if (snapshot.composerVisible) signals.push("COMPOSER_VISIBLE");
    if (buttons > 0) signals.push("INTERACTIVE_UI_PRESENT");
    if (snapshot.cloudflare) signals.push("CLOUDFLARE_UI_SIGNAL");
    if (snapshot.contextExhausted) signals.push("CONTEXT_LIMIT_SIGNAL");
    if (snapshot.generating) signals.push("GENERATION_ACTIVE");
    if (snapshot.stopButtonVisible) signals.push("STOP_CONTROL_VISIBLE");
    if (snapshot.errorText) signals.push("ACTIVE_ERROR_SIGNAL");
    return {
      authenticatedSignals: authText.length,
      composerCount: snapshot.composerCount,
      buttons,
      textareas,
      contenteditables,
      links,
      assistantLikeNodes: snapshot.assistantCount,
      userLikeNodes: snapshot.userCount,
      disabledButtons,
      visibleTextLength: bodyText.length,
      generating: snapshot.generating,
      stopButtonVisible: snapshot.stopButtonVisible,
      sendButtonDisabled: snapshot.sendButtonDisabled,
      chatId: snapshot.chatId,
      uiState: snapshot.state,
      activeErrorText: snapshot.errorText,
      signals,
    };
  }

  private async collectInteractive(page: Page): Promise<InteractiveElement[]> {
    return page.evaluate(() => {
      const visible = (el: Element): boolean => {
        const node = el as HTMLElement;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const elements = Array.from(
        document.querySelectorAll(
          "button, [role=button], textarea, input, [contenteditable=true], a, select"
        )
      );
      return elements.slice(0, 500).map((el) => {
        const htmlEl = el as HTMLInputElement;
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          ariaLabel: el.getAttribute("aria-label"),
          ariaDisabled: el.getAttribute("aria-disabled"),
          title: el.getAttribute("title"),
          name: el.getAttribute("name"),
          type: el.getAttribute("type"),
          placeholder: el.getAttribute("placeholder"),
          testId: el.getAttribute("data-testid"),
          id: el.id || null,
          className: typeof el.className === "string" ? el.className.slice(0, 500) : null,
          text,
          visible: visible(el),
          disabled:
            Boolean((htmlEl as HTMLButtonElement).disabled) ||
            el.getAttribute("aria-disabled") === "true",
        };
      });
    });
  }
}

function sanitizeFilePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "snapshot"
  );
}
