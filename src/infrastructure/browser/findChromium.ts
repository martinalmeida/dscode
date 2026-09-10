import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../logger/logger.js";

const log = createLogger("browser:findChromium");

export function findChromium(opts: { agentInstallDir: string; explicitPath?: string }): {
  executablePath: string | undefined;
  source: string;
} {
  const { agentInstallDir, explicitPath } = opts;
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(agentInstallDir, explicitPath);
    if (fs.existsSync(resolved))
      return { executablePath: resolved, source: "CHROMIUM_EXECUTABLE_PATH" };
    log.warn(
      { explicitPath: resolved },
      "[chromium] CHROMIUM_EXECUTABLE_PATH no existe, fallback a detección automática"
    );
  }
  const platform = os.platform();
  const candidates = getCandidatePaths(platform);
  for (const candidate of candidates)
    if (fs.existsSync(candidate))
      return { executablePath: candidate, source: "detección automática" };
  return { executablePath: undefined, source: "Chromium propio de Playwright" };
}

function getCandidatePaths(platform: string): string[] {
  if (platform === "linux")
    return [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
      "/var/lib/flatpak/exports/bin/org.chromium.Chromium",
      "/var/lib/flatpak/exports/bin/com.google.Chrome",
    ];
  if (platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  if (platform === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const lad = process.env["LOCALAPPDATA"] || "";
    return [
      path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(lad, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf, "Chromium\\Application\\chrome.exe"),
    ];
  }
  return [];
}
