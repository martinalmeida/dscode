#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { runLogin } from "./browser/login.js";
import { createModelClient } from "./providers/index.js";
import { loadProjectContext } from "./contextLoader.js";
import { Agent } from "./agent.js";
import { startPromptLoop } from "./ui/promptLoop.js";

// AGENT_INSTALL_DIR = carpeta real donde vive ESTE programa (resolviendo
// symlinks, importante porque "npm link" instala vía symlink). Todo lo
// que sea configuración/estado del PROGRAMA (.env, storage-state.json,
// selectors.js) vive relativo a esto — nunca al proyecto del usuario.
const __filename = fileURLToPath(import.meta.url);
const AGENT_INSTALL_DIR = fs.realpathSync(path.resolve(path.dirname(__filename), ".."));

dotenv.config({ path: path.join(AGENT_INSTALL_DIR, ".env") });

const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(AGENT_INSTALL_DIR, "package.json"), "utf-8"));
const PRODUCT_NAME = "dscode";

async function main() {
  const subcommand = process.argv[2];

  if (subcommand === "login") {
    await runLogin({ calibrate: false, agentInstallDir: AGENT_INSTALL_DIR });
    process.exit(0);
  }
  if (subcommand === "calibrate") {
    await runLogin({ calibrate: true, agentInstallDir: AGENT_INSTALL_DIR });
    process.exit(0);
  }

  await runAgentSession();
}

async function runAgentSession() {
  const workspaceDir = resolveWorkspaceDir();
  assertWorkspaceIsSafe(workspaceDir);

  const projectName = await detectProjectName(workspaceDir);
  const initialMode = process.argv.includes("--plan") ? "plan" : "build";

  console.log(`\n${PRODUCT_NAME} v${PACKAGE_JSON.version}`);
  console.log(`Proyecto: ${projectName}`);
  console.log(`Workspace: ${workspaceDir}\n`);

  const { systemPromptSection, loadedFiles } = await loadProjectContext(workspaceDir);
  if (loadedFiles.length > 0) {
    console.log(`Contexto cargado (${loadedFiles.length} archivo(s)):`);
    for (const f of loadedFiles) console.log(`  - ${f}`);
  } else {
    console.log(
      "⚠ No se encontró AGENTS.md ni carpetas de convenciones (.agent/, agents/, .deepseek/) en este proyecto."
    );
  }
  console.log("");

  let client;
  try {
    client = createModelClient({ agentInstallDir: AGENT_INSTALL_DIR });
  } catch (err) {
    console.error(`\nError de configuración: ${err.message}\n`);
    process.exit(1);
  }

  const agent = new Agent({
    client,
    model: process.env.DEEPSEEK_MODEL,
    workspaceDir,
    systemPromptContext: systemPromptSection,
    mode: initialMode,
    onEvent: (event) => {
      if (event.type === "tool_call") {
        console.log(`\n[tool] -> ${event.name}(${event.args})`);
      } else if (event.type === "tool_result") {
        const preview =
          typeof event.result === "string" && event.result.length > 300
            ? event.result.slice(0, 300) + "..."
            : event.result;
        console.log(`[tool] <- ${event.name}: ${preview}\n`);
      }
    },
  });
  agent.init();

  console.log("Modo: BUILD (completo) / PLAN (solo lectura) — Tab para alternar.");
  console.log("Ctrl+C para salir.\n");

  let loop;
  const shutdown = async () => {
    loop?.stop();
    await agent.close();
    console.log("\nHasta luego.");
    process.exit(0);
  };

  loop = startPromptLoop({
    projectName,
    initialMode,
    onExit: shutdown,
    onSubmit: async (line, currentMode) => {
      const trimmed = line.trim().toLowerCase();
      if (["salir", "exit", "quit"].includes(trimmed)) {
        await shutdown();
        return;
      }

      agent.setMode(currentMode);
      try {
        const respuesta = await agent.run(line);
        console.log(`\n${respuesta}\n`);
      } catch (err) {
        console.error(`\nError: ${err.message}\n`);
      }
    },
  });
}

/**
 * El workspace SIEMPRE es la carpeta desde donde se invoca el comando
 * (process.cwd()) — así "dscode" se usa igual que "opencode" o
 * "claude code": entras a tu proyecto y lo corres ahí. Se puede forzar
 * otra carpeta con --dir <ruta> si hace falta.
 */
function resolveWorkspaceDir() {
  const dirFlagIndex = process.argv.indexOf("--dir");
  if (dirFlagIndex !== -1 && process.argv[dirFlagIndex + 1]) {
    return path.resolve(process.argv[dirFlagIndex + 1]);
  }
  return process.cwd();
}

/**
 * Protección crítica: el agente NUNCA debe operar sobre su propia carpeta
 * de instalación (podría reescribirse o dañarse a sí mismo). Se compara
 * con realpath para que ni siquiera un symlink (ej. "npm link") lo
 * esquive.
 */
function assertWorkspaceIsSafe(workspaceDir) {
  let realWorkspace;
  try {
    realWorkspace = fs.realpathSync(workspaceDir);
  } catch {
    console.error(`\nLa carpeta "${workspaceDir}" no existe o no es accesible.\n`);
    process.exit(1);
  }

  const isSelf =
    realWorkspace === AGENT_INSTALL_DIR || realWorkspace.startsWith(AGENT_INSTALL_DIR + path.sep);

  if (isSelf) {
    console.error(
      `\n⛔ No se puede usar ${PRODUCT_NAME} sobre su propia carpeta de instalación (${AGENT_INSTALL_DIR}).\n` +
        "Esto es una protección para que el agente nunca se modifique o dañe a sí mismo.\n" +
        "Ve (cd) a la carpeta de TU proyecto y vuelve a correr el comando desde ahí,\n" +
        "o usa --dir <ruta-de-tu-proyecto>.\n"
    );
    process.exit(1);
  }
}

async function detectProjectName(workspaceDir) {
  try {
    const pkgPath = path.join(workspaceDir, "package.json");
    const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf-8"));
    if (pkg.name) return pkg.name;
  } catch {
    // no hay package.json o no tiene "name" — no pasa nada
  }
  return path.basename(workspaceDir);
}

main().catch((err) => {
  console.error(`\nError fatal: ${err.message}\n`);
  process.exit(1);
});
