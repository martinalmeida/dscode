import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
// src/config/app.config.ts -> src/config -> src -> ROOT (= dist/../.. tras build)
// En dev (src/app/cli.ts) y en prod (dist/app/cli.js) la lógica es distinta.
// Por eso el cálculo de AGENT_INSTALL_DIR vive en cli.ts; aquí solo helpers.

export function resolveAgentInstallDir(entryFileUrl: string): string {
  const entryPath = fileURLToPath(entryFileUrl);
  // entry es src/app/cli.ts (dev) o dist/app/cli.js (prod) — en ambos casos subir 2 niveles desde /app es src/ o dist/
  // y un nivel más es la raíz del proyecto (donde vive package.json / .env)
  // Para npm link, el realpath resuelve el symlink.
  const dir = path.dirname(entryPath);
  // dist/app -> dist -> raíz ; src/app -> src -> raíz
  const candidate = path.resolve(dir, "../..");
  try {
    return fs.realpathSync(candidate);
  } catch {
    return candidate;
  }
}

export { APP_CONSTANTS } from "../shared/constants.js";
