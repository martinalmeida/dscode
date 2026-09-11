#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { runLogin } from "../infrastructure/browser/login.js";
import { createModelClient } from "../infrastructure/providers/index.js";
import { loadProjectContext } from "./context/loader.js";
import { Agent } from "./agent/agent.js";
import { printBanner } from "../ui/banner.js";
import { createSpinner } from "../ui/spinner.js";
import {
  printAgentBubble,
  printToolCall,
  printToolResult,
  printErrorBubble,
} from "../ui/bubble.js";
import { startPromptLoop } from "../ui/promptLoop.js";
import { createLogger } from "../infrastructure/logger/logger.js";

const __filename = fileURLToPath(import.meta.url);
const AGENT_INSTALL_DIR = fs.realpathSync(path.resolve(path.dirname(__filename), "../.."));

dotenv.config({ path: path.join(AGENT_INSTALL_DIR, ".env") });

const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.join(AGENT_INSTALL_DIR, "package.json"), "utf-8")
) as { version: string };
const PRODUCT_NAME = "dscode";
const log = createLogger("app:cli");

async function main(): Promise<void> {
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

async function runAgentSession(): Promise<void> {
  const workspaceDir = resolveWorkspaceDir();
  assertWorkspaceIsSafe(workspaceDir);
  const projectName = await detectProjectName(workspaceDir);
  const initialMode = process.argv.includes("--plan") ? ("plan" as const) : ("build" as const);

  printBanner();
  const { systemPromptSection, loadedFiles } = await loadProjectContext(workspaceDir);
  const ctxInfo = loadedFiles.length > 0 ? loadedFiles.join(", ") : "sin contexto";
  // Header compacto en 2 líneas
  console.log(
    `\x1b[2m${PRODUCT_NAME} v${PACKAGE_JSON.version}  \x1b[0m\x1b[36m${projectName}\x1b[0m \x1b[2m${workspaceDir} · ${ctxInfo}\x1b[0m`
  );

  let client: ReturnType<typeof createModelClient>;
  try {
    client = createModelClient({ agentInstallDir: AGENT_INSTALL_DIR });
  } catch (err) {
    console.error(`\nError de configuración: ${(err as Error).message}\n`);
    process.exit(1);
  }

  log.debug({ workspaceDir, projectName, mode: initialMode }, "Sesión iniciada");

  let activeSpinner: ReturnType<typeof createSpinner> | null = null;
  const agent = new Agent({
    client: client as never,
    workspaceDir,
    systemPromptContext: systemPromptSection,
    mode: initialMode,
    onEvent: (event) => {
      if (event.type === "tool_call") {
        activeSpinner?.pause();
        printToolCall(event.name, event.args ?? "");
        activeSpinner?.resume(`Ejecutando ${event.name}`);
        log.debug({ tool: event.name }, "tool_call");
      } else if (event.type === "tool_result") {
        activeSpinner?.pause();
        const preview =
          typeof event.result === "string" && event.result.length > 300
            ? event.result.slice(0, 300) + "..."
            : (event.result ?? "");
        printToolResult(event.name, preview);
        activeSpinner?.resume("Consultando DeepSeek");
      }
    },
  });
  agent.init();

  console.log(
    `\x1b[2m[${initialMode === "plan" ? "PLAN" : "BUILD"}] Tab alterna · Ctrl+C salir\x1b[0m\n`
  );

  let loop: ReturnType<typeof startPromptLoop> | null = null;
  const shutdown = async (): Promise<void> => {
    loop?.stop();
    await agent.close();
    console.log("\nHasta luego.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
      const spinner = createSpinner();
      activeSpinner = spinner;
      // cablear controles de IO para que confirm() pueda pausar spinner+input sin choque
      agent.setIOControls({
        pauseInput: () => loop?.pauseInput(),
        resumeInput: () => loop?.resumeInput(),
        pauseSpinner: () => activeSpinner?.pause(),
        resumeSpinner: (msg?: string) => activeSpinner?.resume(msg),
      });
      spinner.start("Consultando DeepSeek");
      try {
        const respuesta = await agent.run(line);
        spinner.stop();
        activeSpinner = null;
        if (respuesta && String(respuesta).trim()) printAgentBubble(String(respuesta).trim());
      } catch (err) {
        spinner.stop();
        activeSpinner = null;
        printErrorBubble((err as Error).message);
        log.error({ err }, "Error en run");
      }
    },
  });
}

function resolveWorkspaceDir(): string {
  const dirFlagIndex = process.argv.indexOf("--dir");
  const next = process.argv[dirFlagIndex + 1];
  if (dirFlagIndex !== -1 && next) return path.resolve(next);
  return process.cwd();
}

function assertWorkspaceIsSafe(workspaceDir: string): void {
  let realWorkspace: string;
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
      `\n⛔ No se puede usar ${PRODUCT_NAME} sobre su propia carpeta de instalación (${AGENT_INSTALL_DIR}).\nEsto es una protección para que el agente nunca se modifique o dañe a sí mismo.\nVe (cd) a la carpeta de TU proyecto y vuelve a correr el comando desde ahí,\no usa --dir <ruta-de-tu-proyecto>.\n`
    );
    process.exit(1);
  }
}

async function detectProjectName(workspaceDir: string): Promise<string> {
  try {
    const pkgPath = path.join(workspaceDir, "package.json");
    const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf-8")) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {
    /* ignore */
  }
  return path.basename(workspaceDir);
}

main().catch((err: Error) => {
  console.error(`\nError fatal: ${err.message}\n`);
  log.fatal({ err }, "Fatal");
  process.exit(1);
});
