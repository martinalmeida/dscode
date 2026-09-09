import pino, { type Logger } from "pino";

function resolveLevel(): string {
  const raw = (process.env.LOG_LEVEL ?? process.env.LOGLEVEL ?? "info").replace(/\r/g, "").trim().replace(/^['"]+|['"]+$/g, "").toLowerCase();
  const allowed = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
  return allowed.has(raw) ? raw : "info";
}

function shouldUsePretty(): boolean {
  const envPretty = (process.env.LOG_PRETTY ?? "").replace(/\r/g, "").trim().replace(/^['"]+|['"]+$/g, "").toLowerCase();
  if (["true", "1", "yes", "on", "sí", "si"].includes(envPretty)) return true;
  if (["false", "0", "no", "off"].includes(envPretty)) return false;
  // pretty por defecto en desarrollo (no production) y si hay TTY
  return process.env.NODE_ENV !== "production" && Boolean(process.stdout.isTTY);
}

let rootLogger: Logger | null = null;

export function getRootLogger(): Logger {
  if (rootLogger) return rootLogger;

  const level = resolveLevel();
  const usePretty = shouldUsePretty();

  rootLogger = pino({
    level,
    // JSON en producción, pretty en dev — sin perder campos
    transport: usePretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            singleLine: false,
          },
        }
      : undefined,
    // nunca loggear secretos
    redact: {
      paths: [
        "apiKey",
        "api_key",
        "DEEPSEEK_API_KEY",
        "token",
        "password",
        "storageState",
        "*.apiKey",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "dscode" },
  });

  return rootLogger;
}

export function createLogger(context: string): Logger {
  return getRootLogger().child({ context });
}

// Tipos re-exportados para consumidores
export type { Logger };
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
