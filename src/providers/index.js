import path from "node:path";
import OpenAI from "openai";
import { DeepSeekWebClient } from "./webClient.js";
import { getEnvString, getEnvBool, getEnvNumber } from "../envUtils.js";
import { findChromium } from "../browser/findChromium.js";

export function createModelClient({ agentInstallDir }) {
  const provider = getEnvString("MODEL_PROVIDER", "web").toLowerCase();

  if (provider === "api") {
    const apiKey = getEnvString("DEEPSEEK_API_KEY");
    if (!apiKey) {
      throw new Error(
        'MODEL_PROVIDER=api requiere DEEPSEEK_API_KEY en tu .env (sácala en platform.deepseek.com).'
      );
    }
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
      // storage-state.json vive junto al programa (AGENT_INSTALL_DIR), NO
      // en el proyecto del usuario — es la sesión del navegador, no algo
      // que tenga sentido versionar o mezclar con el código del proyecto.
      // Por eso se resuelve SIEMPRE contra agentInstallDir, nunca contra
      // el cwd (que ahora es la carpeta del proyecto del usuario).
      storageStatePath: path.resolve(
        agentInstallDir,
        getEnvString("STORAGE_STATE_PATH", "./storage-state.json")
      ),
      responseTimeoutMs: getEnvNumber("RESPONSE_TIMEOUT_MS", 300000),
      chromiumExecutablePath: chromium.executablePath,
    };

    return new DeepSeekWebClient(config);
  }

  throw new Error(`MODEL_PROVIDER desconocido: "${provider}". Usa "web" o "api" en tu .env.`);
}
