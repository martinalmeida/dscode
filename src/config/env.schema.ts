import { z } from "zod";
import { ConfigError } from "../shared/errors.js";

export const envSchema = z.object({
  MODEL_PROVIDER: z
    .string()
    .optional()
    .transform((v) => (v ?? "web").replace(/\r/g, "").trim().replace(/^['"]+|['"]+$/g, "").toLowerCase())
    .pipe(z.enum(["web", "api"])),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_API_BASE_URL: z.string().url().optional().default("https://api.deepseek.com"),
  CHAT_URL: z.string().url().default("https://chat.deepseek.com/"),
  HEADLESS: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return true;
      const c = v.replace(/\r/g, "").trim().replace(/^['"]+|['"]+$/g, "").toLowerCase();
      return ["true", "1", "yes", "on", "sí", "si"].includes(c);
    })
    .pipe(z.boolean()),
  STORAGE_STATE_PATH: z.string().default("./storage-state.json"),
  RESPONSE_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 300000;
      const n = Number(v.replace(/\r/g, "").trim().replace(/^['"]+|['"]+$/g, ""));
      return Number.isFinite(n) ? n : 300000;
    })
    .pipe(z.number()),
  LOG_LEVEL: z
    .string()
    .optional()
    .transform((v) => (v ?? "info").replace(/\r/g, "").trim().replace(/^['"]+|['"]+$/g, "").toLowerCase())
    .pipe(z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])),
  LOG_PRETTY: z.string().optional(),
  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cached: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Config inválida (.env): ${msg}`);
  }
  // validación cruzada: api requiere key
  if (parsed.data.MODEL_PROVIDER === "api" && !parsed.data.DEEPSEEK_API_KEY) {
    throw new ConfigError("MODEL_PROVIDER=api requiere DEEPSEEK_API_KEY en tu .env (platform.deepseek.com)");
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
