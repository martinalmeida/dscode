/**
 * Lee variables de entorno de forma robusta contra los problemas de
 * formato más comunes en archivos .env editados a mano:
 *   - espacios sobrantes al inicio/final
 *   - comillas simples o dobles envolviendo el valor ("true" en vez de true)
 *   - fin de línea estilo Windows (\r\n) que deja un "\r" invisible pegado
 *     al valor — esto hace que "true\r" !== "true" aunque en pantalla se
 *     vea idéntico a simple vista.
 *   - variantes de "verdadero" además de "true" (1, yes, on)
 *
 * Usar estas funciones en vez de leer process.env directo evita volver a
 * perseguir un bug de "por qué no toma el valor si el archivo se ve bien".
 */

function clean(raw) {
  if (raw === undefined || raw === null) return undefined;
  return raw
    .replace(/\r/g, "") // fin de línea estilo Windows
    .trim()
    .replace(/^['"]|['"]$/g, ""); // comillas envolventes
}

export function getEnvString(name, defaultValue = "") {
  const cleaned = clean(process.env[name]);
  return cleaned === undefined || cleaned === "" ? defaultValue : cleaned;
}

export function getEnvBool(name, defaultValue = false) {
  const cleaned = clean(process.env[name]);
  if (cleaned === undefined || cleaned === "") return defaultValue;
  return ["true", "1", "yes", "on", "sí", "si"].includes(cleaned.toLowerCase());
}

export function getEnvNumber(name, defaultValue) {
  const cleaned = clean(process.env[name]);
  if (cleaned === undefined || cleaned === "") return defaultValue;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : defaultValue;
}
