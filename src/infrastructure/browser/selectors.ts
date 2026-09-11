// Verificado 2026-09-10: selectores robustos multilingüe (ES/EN/ZH) — DeepSeek cambia DOM frecuente
// Orden: contenteditable visible primero (DeepSeek Lexical 2025-26), luego textarea visible. Se excluyen hidden aria/off-screen.
export const SELECTORS = {
  // Playwright locators: se usan con page.locator().first() o resolveTextarea(). Los genéricos textarea/[role=textbox] al final son fallback.
  textarea:
    'div[contenteditable="true"][role="textbox"]:not([aria-hidden="true"]), div[contenteditable="true"]:not([aria-hidden="true"]), textarea#chat-input:not([aria-hidden="true"]), textarea[placeholder*="Ask" i]:not([aria-hidden="true"]), textarea[placeholder*="Message" i]:not([aria-hidden="true"]), textarea[placeholder*="发送" i]:not([aria-hidden="true"]), textarea:not([aria-hidden="true"]), [role="textbox"]:not([aria-hidden="true"])',
  sendButton:
    'button[type="submit"], button[aria-label*="Send" i], button[aria-label*="发送" i], button[aria-label*="Enviar" i], div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle, button:has-text("Send"), button:has-text("Enviar")',
  // assistantMessage: ordenado de más específico a más genérico. Evita capturar user-markdown filtrando por contenedor assistant/copy-button más abajo
  assistantMessage:
    "[data-role='assistant'], [data-testid='message-assistant'], [data-message-role='assistant'], div[class*='assistant'] .ds-markdown, div[class*='assistant'] [class*='markdown'], div:has(button[aria-label*=\"Copy\" i]) [class*='markdown'], .ds-markdown, .markdown-body",
  stopGeneratingButton:
    'button[aria-label*="Stop" i], button[aria-label*="停止" i], button[aria-label*="Detener" i], div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle.ds-button--loading, button:has-text("Stop"), button:has-text("Detener"), [class*="loading"] button',
  newChatButton: "text=/^(New chat|Nuevo chat|新对话)$/i",
  cloudflareChallenge:
    'iframe[src*="challenges.cloudflare.com"], #cf-overlay, [data-sitekey], [data-testid="turnstile"]',
} as const;
