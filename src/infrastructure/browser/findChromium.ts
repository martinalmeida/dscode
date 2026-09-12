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
  const candidates = getCandidatePaths(platform, agentInstallDir);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return { executablePath: candidate, source: `detección automática: ${candidate}` };
      } catch {
        log.warn({ candidate }, "[chromium] candidato encontrado pero no es ejecutable");
      }
    }
  }
  return { executablePath: undefined, source: "Chromium propio de Playwright" };
}

function getCandidatePaths(platform: string, agentInstallDir: string): string[] {
  const cwd = process.cwd();
  const localBundled = [
    path.resolve(cwd, "chrome-linux64", "chrome"),
    path.resolve(cwd, "chrome-linux64", "chrome-linux64", "chrome"),
    path.resolve(agentInstallDir, "chrome-linux64", "chrome"),
    path.resolve(agentInstallDir, "chrome-linux64", "chrome-linux64", "chrome"),
  ];

  if (platform === "linux")
    return [
      ...localBundled,
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
      ...localBundled,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  if (platform === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const lad = process.env["LOCALAPPDATA"] || "";
    return [
      path.resolve(cwd, "chrome-linux64", "chrome.exe"),
      path.resolve(agentInstallDir, "chrome-linux64", "chrome.exe"),
      path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(lad, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(lad, "Chromium\\Application\\chrome.exe"),
    ];
  }
  return [];
}
