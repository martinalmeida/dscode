/**
 * Helpers robustos para leer process.env — toleran espacios, comillas,
 * \r de Windows y variantes de "verdadero". Re-exportado para compatibilidad
 * con el antiguo envUtils.js.
 */

function clean(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  return raw
    .replace(/\r/g, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");
}

export function getEnvString(name: string, defaultValue = ""): string {
  const cleaned = clean(process.env[name]);
  return cleaned === undefined || cleaned === "" ? defaultValue : cleaned;
}

export function getEnvBool(name: string, defaultValue = false): boolean {
  const cleaned = clean(process.env[name]);
  if (cleaned === undefined || cleaned === "") return defaultValue;
  return ["true", "1", "yes", "on", "sí", "si"].includes(cleaned.toLowerCase());
}

export function getEnvNumber(name: string, defaultValue: number): number {
  const cleaned = clean(process.env[name]);
  if (cleaned === undefined || cleaned === "") return defaultValue;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : defaultValue;
}
