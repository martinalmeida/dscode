import path from "node:path";
import { DeepSeekWebClient } from "./webClient.js";
import { getEnvString, getEnvBool, getEnvNumber } from "../../shared/env.js";
import { findChromium } from "../browser/findChromium.js";
import { createLogger } from "../logger/logger.js";

const log = createLogger("providers:factory");

export function createModelClient(opts: { agentInstallDir: string }): DeepSeekWebClient {
  const { agentInstallDir } = opts;

  // Único motor: chat DeepSeek vía Playwright. Si queda MODEL_PROVIDER en .env, se ignora con aviso.
  const legacyProvider = getEnvString("MODEL_PROVIDER", "");
  if (legacyProvider && legacyProvider.toLowerCase() !== "web") {
    log.warn(
      { legacyProvider },
      "MODEL_PROVIDER está deprecado y se ignora — dscode ahora usa solo web (Playwright). Quita esa variable de tu .env."
    );
  }

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
