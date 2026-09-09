/**
 * ====================================================================
 * ARCHIVO CRÍTICO — VERIFICAR ANTES DE USAR
 * ====================================================================
 * No tengo acceso a chat.deepseek.com para inspeccionar el DOM real,
 * así que estos selectores son mi mejor estimación basada en patrones
 * comunes de chats web (parecidos a ChatGPT/Claude/etc), NO una
 * confirmación de que existen tal cual en la página actual.
 *
 * Antes de usar el puente en serio, corre:
 *   npm run calibrate
 * Esto abre Chromium visible y te deja inspeccionar el DOM con
 * DevTools (F12 -> click derecho en el elemento -> "Inspect") para
 * corregir los selectores de abajo.
 *
 * Qué buscar para cada uno:
 * - textarea: el campo de texto donde escribes el mensaje.
 * - sendButton: el botón de enviar (a veces es un ícono, busca el
 *   <button> padre más cercano).
 * - assistantMessage: el contenedor de CADA mensaje de respuesta del
 *   asistente (no el del usuario). Suele tener una clase como
 *   "message-assistant", "markdown-content", data-role="assistant", etc.
 * - stopGeneratingButton: botón que aparece MIENTRAS el modelo está
 *   generando texto (para saber cuándo terminó: cuando desaparece).
 * - newChatButton: botón para iniciar una conversación nueva.
 * ====================================================================
 */

export const SELECTORS = {
  // CONFIRMADO desde el DOM real que compartiste (build commit-id 95255d1).
  // El textarea tiene name="search", lo cual es más estable que el
  // placeholder (que cambia con el idioma de la interfaz).
  textarea: 'textarea[name="search"]',

  // CONFIRMADO: botón circular de enviar (ícono de avión de papel).
  // Nota: tiene la clase "ds-button--disabled" cuando el textarea está
  // vacío, pero el selector lo encuentra igual; Playwright solo falla al
  // hacer click si sigue disabled en el momento del click.
  sendButton: 'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle',

  // SIN CONFIRMAR TODAVÍA: no había ningún mensaje en el DOM que compartiste
  // (chat vacío). Basado en cómo DeepSeek renderiza markdown en otras
  // integraciones conocidas, la clase más probable es "ds-markdown".
  // VERIFICA esto mandando un mensaje real e inspeccionando la respuesta.
  //
  // OJO con un problema común: si ".ds-markdown" aparece TANTO en el
  // contenedor del mensaje COMO en elementos anidados dentro de él (ej.
  // bloques de código con su propio wrapper markdown), page.locator(...).count()
  // contará de más y "el último elemento" puede ser un fragmento interno,
  // no el mensaje completo. Si ves eso al probar, cambia esta línea por
  // algo como:
  //   assistantMessage: '.ds-markdown:not(.ds-markdown .ds-markdown)'
  // (selecciona solo los que NO están dentro de otro .ds-markdown)
  assistantMessage: '.ds-markdown',

  // SIN CONFIRMAR: no se pudo ver porque no había generación en curso.
  // El botón de enviar probablemente cambia de ícono (avión -> stop)
  // en vez de ser un botón nuevo. Por eso browserSession.js NO depende
  // solo de esto: si no lo encuentra, usa un fallback de polling que mide
  // si el texto de la respuesta dejó de crecer.
  stopGeneratingButton: 'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle.ds-button--loading',

  // CONFIRMADO: es un <div> con texto "Nuevo chat" (no un <button> real).
  newChatButton: 'text=Nuevo chat',

  // CONFIRMADO Y CRÍTICO: overlay de reto Cloudflare Turnstile. Si esto
  // se vuelve visible, Playwright NO puede resolverlo solo — hay que
  // pausar y resolverlo manualmente en una ventana visible (HEADLESS=false).
  cloudflareChallenge: '#cf-overlay',
};

