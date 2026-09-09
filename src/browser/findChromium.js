import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Encuentra un binario de Chromium/Chrome utilizable, SIN depender de una
 * ruta fija de un usuario o máquina en particular (a diferencia de la v1,
 * donde CHROMIUM_EXECUTABLE_PATH tenía que ser una ruta absoluta como
 * "/home/martin/...", que rompía en cualquier otra máquina o sistema
 * operativo).
 *
 * Orden de búsqueda:
 *   1. CHROMIUM_EXECUTABLE_PATH en .env, si está seteada:
 *      - Si es una ruta ABSOLUTA, se usa tal cual (para quien quiera fijar
 *        una ruta específica de forma explícita).
 *      - Si es una ruta RELATIVA, se resuelve contra AGENT_INSTALL_DIR
 *        (la carpeta de instalación de este programa), NUNCA contra el
 *        proyecto del usuario — así puedes tener ./chrome-bin/chrome
 *        junto al propio dscode y funciona igual sin importar desde qué
 *        proyecto lo invoques.
 *   2. Ubicaciones típicas de Chrome/Chromium instalados en el sistema,
 *      según el sistema operativo detectado.
 *   3. Si nada de eso aparece, se devuelve undefined y Playwright usa su
 *      propio Chromium descargado (si está disponible en caché).
 */
export function findChromium({ agentInstallDir, explicitPath }) {
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(agentInstallDir, explicitPath);

    if (fs.existsSync(resolved)) {
      return { executablePath: resolved, source: "CHROMIUM_EXECUTABLE_PATH" };
    }
    console.warn(
      `[chromium] CHROMIUM_EXECUTABLE_PATH apunta a "${resolved}" pero no existe ahí. ` +
        "Se intentará detectar automáticamente en el sistema."
    );
  }

  const platform = os.platform();
  const candidates = getCandidatePaths(platform);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { executablePath: candidate, source: "detección automática" };
    }
  }

  return { executablePath: undefined, source: "Chromium propio de Playwright" };
}

function getCandidatePaths(platform) {
  if (platform === "linux") {
    return [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
      "/var/lib/flatpak/exports/bin/org.chromium.Chromium",
      "/var/lib/flatpak/exports/bin/com.google.Chrome",
    ];
  }

  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  }

  if (platform === "win32") {
    const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] || "";
    return [
      path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFiles, "Chromium\\Application\\chrome.exe"),
    ];
  }

  return [];
}
