import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from "playwright";
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
  browser: Browser;
  context: BrowserContext;
  page: Page;
  historyLength: number;
  config: SessionConfig;
}

const log = createLogger("browser:session");

export const DSCODE_AUTH_REQUIRED = "[DSCODE_AUTH_REQUIRED]";

function authError(message: string): Error {
  const err = new Error(`${DSCODE_AUTH_REQUIRED} ${message}`);
  (err as Error & { code?: string }).code = "AUTH_REQUIRED";
  return err;
}

async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (/\/(login|signin|sign-in|auth)(\/|\?|$)/i.test(url)) return true;
  const signals = page.locator(
    'input[type="password"], input[name*="password" i], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), text=/Iniciar sesión/i, text=/Sign in/i, text=/Log in/i'
  );
  if ((await signals.count().catch(() => 0)) > 0) return true;

  // DeepSeek puede mostrar la pantalla de autenticación sin usar un input
  // de contraseña (OAuth/captcha). Inspeccionamos solo texto visible.
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 1500 })
    .catch(() => "");
  if (/Iniciar sesión|Iniciar sesion|Sign in|Log in|Create account|Crear cuenta/i.test(bodyText)) {
    const composer = await resolveTextarea(page);
    if (!(await composer.isVisible().catch(() => false))) return true;
  }
  return false;
}

export async function waitForChatReady(page: Page, timeoutMs = 12000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoginPage(page)) {
      throw authError(
        "No hay una sesión activa de DeepSeek. Ejecuta 'dscode login' y vuelve a intentarlo."
      );
    }
    const textarea = await resolveTextarea(page);
    if (await textarea.isVisible().catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  if (await isLoginPage(page)) {
    throw authError(
      "La sesión de DeepSeek no está autenticada. Ejecuta 'dscode login' para guardar una sesión válida."
    );
  }
  throw new Error(
    `No se encontró el cuadro de mensaje de DeepSeek después de ${timeoutMs} ms. La interfaz pudo haber cambiado o la página no terminó de cargar.`
  );
}

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
  const contextOptions: { storageState?: string; permissions?: string[] } = {};
  const hasStorageState = fs.existsSync(storageStatePath);
  if (hasStorageState) contextOptions.storageState = storageStatePath;
  else log.warn({ storageStatePath }, "storageState no existe");
  // Clipboard necesario para fallback de payloads grandes (24k) vía Ctrl+V
  (contextOptions as { permissions?: string[] }).permissions = [
    "clipboard-read",
    "clipboard-write",
  ];
  const context = await browser.newContext(contextOptions as never);
  const page = await context.newPage();
  await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  if (!hasStorageState) {
    await browser.close();
    throw authError(
      `No existe ${storageStatePath}. Ejecuta 'dscode login' para iniciar sesión en DeepSeek y guardar una sesión válida.`
    );
  }
  if (await isLoginPage(page)) {
    await browser.close();
    throw authError(
      `La sesión guardada de DeepSeek ya no es válida. Ejecuta 'dscode login' para renovarla.`
    );
  }
  return { browser, context, page, historyLength: 0, config };
}

export async function closeSession(session: Session | null | undefined): Promise<void> {
  if (!session) return;
  if (session.context)
    await session.context.close().catch((e) => log.warn({ err: e }, "close context failed"));
  if (session.browser)
    await session.browser.close().catch((e) => log.warn({ err: e }, "close browser failed"));
}

async function checkForCloudflareChallenge(page: Page): Promise<void> {
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

async function resolveTextarea(page: Page): Promise<Locator> {
  // Prioriza elemento visible con tamaño real (>10px) para evitar hidden textarea espejo (Lexical off-screen)
  const candidates = [
    'div[contenteditable="true"][role="textbox"]:not([aria-hidden="true"])',
    'div[contenteditable="true"]:not([aria-hidden="true"])',
    'textarea#chat-input:not([aria-hidden="true"])',
    'textarea[placeholder*="Ask" i]:not([aria-hidden="true"])',
    'textarea[placeholder*="Message" i]:not([aria-hidden="true"])',
    'textarea[placeholder*="Mensaje" i]:not([aria-hidden="true"])',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    const cnt = await loc.count().catch(() => 0);
    for (let i = 0; i < cnt; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 10 && box.height > 10) return el;
      // Si no hay box pero es visible, igual sirve (algunos contenteditable reportan null box en headless)
      if (!box) return el;
    }
  }
  // Fallback: primer match del selector compuesto (mantiene compat)
  return page.locator(SELECTORS.textarea).first();
}

export async function sendMessage(
  session: Session,
  text: string,
  opts: { onSubmitted?: () => void } = {}
): Promise<string> {
  const { page } = session;
  await checkForCloudflareChallenge(page);
  await waitForChatReady(page, 12000);
  let textarea = await resolveTextarea(page);
  await textarea.waitFor({ state: "visible", timeout: 5000 });
  // Heavy: evaluate para textos largos (fill valida char por char y revienta con 15k+ systemPrompt)
  const useEvaluate = text.length > 3500;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await textarea.click().catch(() => {});
      // Re-resolver en reintentos por si cambió el DOM
      if (attempt > 0) {
        await page.waitForTimeout(400);
        textarea = await resolveTextarea(page);
        await textarea.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
        await textarea.click().catch(() => {});
      }
      if (useEvaluate) {
        if (attempt === 0) {
          // Intento 0: native setter + InputEvent con data (React controlled)
          await textarea.evaluate((el: HTMLElement, v: string) => {
            el.focus();
            const isInput = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
            if (isInput) {
              const proto =
                el instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              const desc = Object.getOwnPropertyDescriptor(proto, "value");
              try {
                desc?.set?.call(el, v);
              } catch {
                (el as HTMLTextAreaElement).value = v;
              }
              // React _valueTracker
              try {
                const tracker = (
                  el as unknown as { _valueTracker?: { setValue: (x: string) => void } }
                )._valueTracker;
                if (tracker) tracker.setValue("");
              } catch (_e) {
                void _e;
              }
              try {
                el.dispatchEvent(
                  new InputEvent("beforeinput", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertText",
                    data: v,
                  } as unknown as InputEventInit)
                );
              } catch (_e) {
                void _e;
              }
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  inputType: "insertText",
                  data: v,
                } as unknown as InputEventInit)
              );
              el.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              // contenteditable (Lexical/ProseMirror)
              el.focus();
              // Intentar execCommand primero (más trusted por editores)
              let inserted = false;
              try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore execCommand deprecated pero aún trusted por Lexical
                if (
                  document.queryCommandSupported &&
                  document.queryCommandSupported("insertText")
                ) {
                  (
                    document as unknown as {
                      execCommand: (a: string, b: boolean, c: string) => boolean;
                    }
                  ).execCommand("selectAll", false, "");
                  inserted = (
                    document as unknown as {
                      execCommand: (a: string, b: boolean, c: string) => boolean;
                    }
                  ).execCommand("insertText", false, v);
                }
              } catch (_e) {
                void _e;
              }
              if (!inserted || (el.textContent ?? "").length === 0) {
                // Fallback: construir DOM manualmente
                el.textContent = "";
                // Lexical espera <p> por línea
                const frag = document.createDocumentFragment();
                const lines = v.split("\n");
                for (const line of lines) {
                  const p = document.createElement("p");
                  p.textContent = line || "\u200B"; // zero-width para líneas vacías
                  frag.appendChild(p);
                }
                el.appendChild(frag);
                try {
                  el.dispatchEvent(
                    new InputEvent("beforeinput", {
                      bubbles: true,
                      inputType: "insertText",
                      data: v,
                    } as unknown as InputEventInit)
                  );
                } catch (_e) {
                  void _e;
                }
                el.dispatchEvent(
                  new InputEvent("input", {
                    bubbles: true,
                    inputType: "insertText",
                    data: v,
                  } as unknown as InputEventInit)
                );
              } else {
                el.dispatchEvent(
                  new InputEvent("input", {
                    bubbles: true,
                    inputType: "insertText",
                    data: v,
                  } as unknown as InputEventInit)
                );
              }
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, text);
        } else if (attempt === 1) {
          // Intento 1: clipboard + paste (humano)
          try {
            await page.evaluate((v: string) => navigator.clipboard.writeText(v), text);
          } catch (_e) {
            void _e;
          }
          await textarea.click().catch(() => {});
          await page.keyboard.press("Control+A").catch(() => {});
          await page.waitForTimeout(80);
          // Intentar dispatch paste sintético + Ctrl+V
          try {
            await page.keyboard.press("Control+V");
          } catch (_e) {
            void _e;
          }
          await page.waitForTimeout(200);
          // Si sigue 0, fallback a execCommand directo
          const curLen = await textarea
            .evaluate((el: HTMLElement) => {
              const v = (el as HTMLTextAreaElement).value;
              if (typeof v === "string" && v.length > 0) return v.length;
              return (el.textContent ?? "").length || ((el as HTMLElement).innerText ?? "").length;
            })
            .catch(() => 0);
          if (curLen === 0) {
            await textarea.evaluate((el: HTMLElement, v: string) => {
              el.focus();
              try {
                (
                  document as unknown as {
                    execCommand: (a: string, b: boolean, c: string) => boolean;
                  }
                ).execCommand("selectAll", false, "");
                (
                  document as unknown as {
                    execCommand: (a: string, b: boolean, c: string) => boolean;
                  }
                ).execCommand("insertText", false, v);
              } catch {
                el.textContent = v;
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, text);
          }
        } else {
          // Intento 2: último recurso — fill chunked no usado antes, pero aquí type con delay
          await textarea.evaluate((el: HTMLElement, v: string) => {
            el.focus();
            if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
              const proto =
                el instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
              el.dispatchEvent(new Event("input", { bubbles: true }));
            } else el.textContent = v;
          }, text);
        }
        await page.waitForTimeout(180);
        // Verificación: ¿realmente quedó el texto?
        const actualLen = await textarea
          .evaluate((el: HTMLElement) => {
            const val = (el as HTMLTextAreaElement).value;
            if (typeof val === "string" && val.length > 0) return val.length;
            const txt = (el.textContent ?? "").length;
            const inner = ((el as HTMLElement).innerText ?? "").length;
            // Para contenteditable con <p> por línea, textContent incluye todo; innerText también
            return Math.max(txt, inner, val?.length ?? 0);
          })
          .catch(() => -1);
        if (
          actualLen !== -1 &&
          Math.abs(actualLen - text.length) > Math.max(200, text.length * 0.1)
        ) {
          log.warn(
            { expected: text.length, actual: actualLen, attempt },
            "textarea evaluate longitud no coincide — reintentando"
          );
          throw new Error(`textarea mismatch ${actualLen} vs ${text.length}`);
        }
      } else await textarea.fill(text);
      break;
    } catch (err) {
      const msg = ((err as Error).message || "").slice(0, 400);
      if (attempt === 2) throw new Error(msg);
      log.warn({ err: msg, useEvaluate, attempt }, "textarea click/fill reintento");
      await page.waitForTimeout(800);
    }
  }
  // Detección temprana de sesión expirada: si seguimos en /login no hay donde enviar
  try {
    const url = page.url();
    if (url.includes("/login") || url.includes("/auth")) {
      throw new Error(
        `Sesión expirada — redirigido a ${url}. Corre 'dscode login' para renovar storage-state.json`
      );
    }
  } catch (e) {
    if ((e as Error).message.includes("Sesión expirada")) throw e;
  }
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
    // SELECTORS.sendButton contiene :has-text que no es válido en document.querySelector — filtrar a CSS puro para waitForFunction
    const cssOnly = SELECTORS.sendButton
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !s.includes("has-text") && !s.includes("text="))
      .join(", ");
    if (cssOnly) {
      await page
        .waitForFunction(
          (selector: string) => {
            const els = document.querySelectorAll(selector);
            for (const el of Array.from(els)) {
              const he = el as HTMLElement;
              if (!he.offsetParent) continue; // hidden
              if (he.className.includes("disabled")) continue;
              if ((he as HTMLButtonElement).disabled) continue;
              if (he.getAttribute("aria-disabled") === "true") continue;
              return true;
            }
            return false;
          },
          cssOnly,
          { timeout: 4000 }
        )
        .catch((e) => log.debug({ err: e }, "sendButton waitFunction timeout"));
    }
    // Si sigue disabled, no esperar 300s — fallar rápido y reintentar
    const stillDisabled = await sendButton
      .evaluate((el: HTMLElement) => {
        if (el.className.includes("disabled")) return true;
        if ((el as HTMLButtonElement).disabled) return true;
        if (el.getAttribute("aria-disabled") === "true") return true;
        return false;
      })
      .catch(() => false);
    if (stillDisabled) {
      // No hacer click ciego que nunca genera request → lanzar mismatch para que sendWithRetry pruebe fallback clipboard/execCommand
      log.warn("sendButton sigue disabled tras evaluate — posible textarea no propagado");
      throw new Error(
        `textarea mismatch sendButton disabled (stillDisabled) — textarea no propagado`
      );
    }
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
  page: Page,
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
