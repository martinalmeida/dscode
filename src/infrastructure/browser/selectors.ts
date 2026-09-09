// Verificado 2026-09-09: selectores genéricos fallback — DeepSeek cambia DOM frecuente
export const SELECTORS = {
  // textarea genérico funciona aunque cambie name/id; fallback contenteditable
  textarea: 'textarea, textarea#chat-input, div[contenteditable="true"]',
  sendButton:
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle, button[aria-label*="Send" i], button:has-text("Send")',
  assistantMessage: ".ds-markdown, [data-testid='message-assistant']",
  stopGeneratingButton:
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle.ds-button--loading, button:has-text("Stop")',
  newChatButton: "text=/^(New chat|Nuevo chat)$/i",
  cloudflareChallenge: 'iframe[src*="challenges.cloudflare.com"], #cf-overlay, [data-sitekey]',
} as const;
