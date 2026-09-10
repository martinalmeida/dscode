// Verificado 2026-09-09: selectores genéricos fallback — DeepSeek cambia DOM frecuente
export const SELECTORS = {
  // textarea genérico funciona aunque cambie name/id; fallback contenteditable
  textarea: 'textarea, textarea#chat-input, div[contenteditable="true"], [role="textbox"]',
  sendButton:
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle, button[aria-label*="Send" i], button:has-text("Send"), button:has-text("Enviar")',
  assistantMessage:
    ".ds-markdown, [data-testid='message-assistant'], [data-role='assistant'], .markdown-body, div[class*='assistant'] .ds-markdown",
  stopGeneratingButton:
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle.ds-button--loading, button:has-text("Stop"), button:has-text("Detener"), [aria-label*="Stop" i]',
  newChatButton: "text=/^(New chat|Nuevo chat)$/i",
  cloudflareChallenge: 'iframe[src*="challenges.cloudflare.com"], #cf-overlay, [data-sitekey]',
} as const;
