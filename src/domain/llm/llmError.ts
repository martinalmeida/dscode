export type LLMErrorCode =
  | "TARGET_CLOSED"
  | "PAGE_CLOSED"
  | "BROWSER_DISCONNECTED"
  | "NETWORK_TIMEOUT"
  | "NETWORK_ERROR"
  | "AUTH_REQUIRED"
  | "CLOUDFLARE_CHALLENGE"
  | "DEEPSEEK_UNAVAILABLE"
  | "CONTEXT_EXHAUSTED"
  | "CHAT_NOT_FOUND"
  | "COMPOSER_NOT_FOUND"
  | "SEND_FAILED"
  | "RESPONSE_TIMEOUT"
  | "PROTOCOL_ERROR"
  | "UNKNOWN";

export interface LLMErrorInfo {
  code: LLMErrorCode;
  message: string;
  retryable: boolean;
  canReuseSameRequest: boolean;
  canReuseSameChat: boolean;
  requiresNewChat: boolean;
}

export function classifyLLMError(error: unknown): LLMErrorInfo {
  const e = error as Error & { code?: string };
  const message = e?.message || String(error);
  const code = String(e?.code || "").toUpperCase();
  if (
    code === "CONTEXT_EXHAUSTED" ||
    /context.{0,30}(limit|length|capacity)|l[ií]mite.{0,20}contexto/i.test(message)
  )
    return {
      code: "CONTEXT_EXHAUSTED",
      message,
      retryable: true,
      canReuseSameRequest: true,
      canReuseSameChat: false,
      requiresNewChat: true,
    };
  if (code === "AUTH_REQUIRED" || /DSCODE_AUTH_REQUIRED/i.test(message))
    return {
      code: "AUTH_REQUIRED",
      message,
      retryable: true,
      canReuseSameRequest: true,
      canReuseSameChat: false,
      requiresNewChat: true,
    };
  if (code === "CLOUDFLARE_CHALLENGE" || /Cloudflare|Turnstile/i.test(message))
    return {
      code: "CLOUDFLARE_CHALLENGE",
      message,
      retryable: false,
      canReuseSameRequest: true,
      canReuseSameChat: false,
      requiresNewChat: false,
    };
  if (code === "TARGET_CLOSED" || /Target closed/i.test(message))
    return transport("TARGET_CLOSED", message);
  if (code === "PAGE_CLOSED" || /Page closed|page.*closed/i.test(message))
    return transport("PAGE_CLOSED", message);
  if (code === "BROWSER_DISCONNECTED" || /browser.*(closed|disconnect)/i.test(message))
    return transport("BROWSER_DISCONNECTED", message);
  if (
    code === "RESPONSE_TIMEOUT" ||
    /Timeout de .*esperando respuesta|response.*timeout/i.test(message)
  )
    return {
      code: "RESPONSE_TIMEOUT",
      message,
      retryable: false,
      canReuseSameRequest: true,
      canReuseSameChat: false,
      requiresNewChat: false,
    };
  if (code === "NETWORK_TIMEOUT" || /ETIMEDOUT|timeout/i.test(message))
    return transport("NETWORK_TIMEOUT", message);
  if (/ECONNRESET|fetch failed|network/i.test(message)) return transport("NETWORK_ERROR", message);
  if (/protocol|TOOL_CALL/i.test(message))
    return {
      code: "PROTOCOL_ERROR",
      message,
      retryable: false,
      canReuseSameRequest: false,
      canReuseSameChat: true,
      requiresNewChat: false,
    };
  return {
    code: "UNKNOWN",
    message,
    retryable: false,
    canReuseSameRequest: false,
    canReuseSameChat: false,
    requiresNewChat: false,
  };
}
function transport(code: LLMErrorCode, message: string): LLMErrorInfo {
  return {
    code,
    message,
    retryable: true,
    canReuseSameRequest: true,
    canReuseSameChat: false,
    requiresNewChat: false,
  };
}
