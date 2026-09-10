import path from "node:path";
import OpenAI from "openai";
import { DeepSeekWebClient } from "./webClient.js";
import { getEnvString, getEnvBool, getEnvNumber } from "../../shared/env.js";
import { findChromium } from "../browser/findChromium.js";
import { createLogger } from "../logger/logger.js";

const log = createLogger("providers:factory");

export function createModelClient(opts: { agentInstallDir: string }): OpenAI | DeepSeekWebClient {
  const { agentInstallDir } = opts;
  const provider = getEnvString("MODEL_PROVIDER", "web").toLowerCase();
  log.debug({ provider }, "Creando model client");
  if (provider === "api") {
    const apiKey = getEnvString("DEEPSEEK_API_KEY");
    if (!apiKey)
      throw new Error(
        "MODEL_PROVIDER=api requiere DEEPSEEK_API_KEY en tu .env (sácala en platform.deepseek.com)."
      );
    return new OpenAI({
      apiKey,
      baseURL: getEnvString("DEEPSEEK_API_BASE_URL", "https://api.deepseek.com"),
      maxRetries: 0,
      timeout: 10 * 60 * 1000,
    });
  }
  if (provider === "web") {
    const chromium = findChromium({
      agentInstallDir,
      explicitPath: getEnvString("CHROMIUM_EXECUTABLE_PATH") || undefined,
    });
    const config = {
      chatUrl: getEnvString("CHAT_URL", "https://chat.deepseek.com/"),
      headless: getEnvBool("HEADLESS", true),
      storageStatePath: path.resolve(
        agentInstallDir,
        getEnvString("STORAGE_STATE_PATH", "./storage-state.json")
      ),
      responseTimeoutMs: getEnvNumber("RESPONSE_TIMEOUT_MS", 300000),
      chromiumExecutablePath: chromium.executablePath,
    };
    log.debug(
      { headless: config.headless, storageStatePath: config.storageStatePath },
      "Web provider config"
    );
    return new DeepSeekWebClient(config);
  }
  throw new Error(`MODEL_PROVIDER desconocido: "${provider}". Usa "web" o "api" en tu .env.`);
}
