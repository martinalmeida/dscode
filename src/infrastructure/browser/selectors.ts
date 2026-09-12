// DeepSeek Web selectors derived from real DOM captures collected by
// `dscode deepseek inspect --record` on 2026-09-12.
// Prefer semantic/stable markers. Hashed classes are fallback-only.
export const SELECTORS = {
  composer:
    'textarea[placeholder="Mensaje a DeepSeek"]:not([aria-hidden="true"]), textarea[name="search"]:not([aria-hidden="true"]), textarea[placeholder*="Mensaje" i]:not([aria-hidden="true"]), textarea[placeholder*="Message" i]:not([aria-hidden="true"]), textarea[placeholder*="Ask" i]:not([aria-hidden="true"]), div[contenteditable="true"][role="textbox"]:not([aria-hidden="true"]), div[contenteditable="true"]:not([aria-hidden="true"])',
  textarea:
    'textarea[placeholder="Mensaje a DeepSeek"]:not([aria-hidden="true"]), textarea[name="search"]:not([aria-hidden="true"]), div[contenteditable="true"][role="textbox"]:not([aria-hidden="true"]), div[contenteditable="true"]:not([aria-hidden="true"]), textarea[placeholder*="Ask" i]:not([aria-hidden="true"]), textarea[placeholder*="Message" i]:not([aria-hidden="true"]), textarea:not([aria-hidden="true"]), [role="textbox"]:not([aria-hidden="true"])',

  // Observed real structure:
  // assistant: .ds-message > .ds-markdown.ds-assistant-message-main-content
  // user: .ds-message > .ds-collapsible-text
  assistantMessage: ".ds-message:has(.ds-assistant-message-main-content)",
  userMessage: ".ds-message:has(.ds-collapsible-text)",

  // Send and stop are both rendered as div[role=button]. Their stable DeepSeek
  // button classes are combined with the observed SVG path signatures to avoid
  // confusing the stop control with the send control.
  sendButton:
    'div[role="button"].ds-button.ds-button--primary.ds-button--filled.ds-button--circle:has(svg path[d^="M8.3125"]), button[type="submit"], button[aria-label*="Send" i], button[aria-label*="Enviar" i], button[aria-label*="发送" i]',
  stopGeneratingButton:
    'div[role="button"].ds-button.ds-button--primary.ds-button--filled.ds-button--circle:has(svg path[d^="M2 4.88"]), button[aria-label*="Stop" i], button[aria-label*="Detener" i], button[aria-label*="停止" i]',

  newChatButton: "text=/^(New chat|Nuevo chat|新对话)$/i",
  cloudflareChallenge:
    'iframe[src*="challenges.cloudflare.com"], #cf-overlay[style*="display: block"], #cf-turnstile',

  contextLimitPatterns: [
    /context.{0,80}(limit|length|capacity|window|maximum)/i,
    /maximum.{0,30}context/i,
    /context.{0,30}(too long|exceeded|full)/i,
    /l[ií]mite.{0,50}contexto/i,
    /contexto.{0,50}(m[aá]ximo|excedido|lleno)/i,
    /prompt.{0,30}(too long|exceeded)/i,
  ] as const,
} as const;
