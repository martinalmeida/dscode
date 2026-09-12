import fs from "node:fs";
import path from "node:path";
import { color } from "./theme.js";

/** Logo de dscode: D con el hueco interior en forma de corazon (ancho compensado para la terminal). */
const DSCODE_MARK = [
  "████████████",
  "█████  ██  ███",
  "███          ██",
  "███          ███",
  "█████      ████",
  "███████  █████",
  "████████████",
];

// Ancho real del emblema (evita desalinear la columna de info si el arte cambia).
const MARK_WIDTH = Math.max(...DSCODE_MARK.map((line) => line.length));

const WIDTH = 86;

function visibleLength(value: string): number {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").length;
}

function padAnsi(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function fit(value: string, width: number): string {
  const text = String(value ?? "");
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function branchName(workspaceDir: string): string {
  try {
    const head = fs.readFileSync(path.join(workspaceDir, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref: refs/heads/")) return head.slice("ref: refs/heads/".length);
  } catch {
    // Non-git workspace.
  }
  return "sin-git";
}

function contextInfo(workspaceDir: string): string {
  try {
    const file = path.join(workspaceDir, "AGENTS.md");
    const chars = fs.readFileSync(file, "utf8").length;
    return `AGENTS.md cargado (${chars.toLocaleString("es-CO")} chars)`;
  } catch {
    return "AGENTS.md no encontrado";
  }
}

export function printBanner(
  opts: {
    version?: string;
    workspaceDir?: string;
    account?: string;
    model?: string;
    projectName?: string;
    mode?: "plan" | "build";
  } = {}
): void {
  const workspace = opts.workspaceDir ?? process.cwd();
  const version = opts.version ?? "v3.2.1";
  const account = opts.account ?? process.env.DSCODE_ACCOUNT ?? "DeepSeek Web";
  const model = opts.model ?? "DeepSeek Chat (Web · Playwright)";
  const context = contextInfo(workspace);
  const project = opts.projectName ?? path.basename(workspace);
  const branch = branchName(workspace);
  const mode = opts.mode ?? "build";

  const right = [
    `${color("dscode", "white")} ${color(version, "blue")}`,
    `${color("Powered by", "gray")} ${color("DeepSeek", "blue")}`,
    `${color("●", "gray")} ${fit(account, 50)}`,
    `${color("◉", "gray")} ${fit(model, 50)}`,
    `${color("▣", "gray")} ${fit(workspace, 50)}`,
    `${color("▤", "gray")} ${fit(context, 50)}`,
    `${color("✎", "gray")} ${fit("Autor: Martin Almeida", 50)}`,
  ];

  console.log("");
  for (let i = 0; i < Math.max(DSCODE_MARK.length, right.length); i++) {
    const mark = color(DSCODE_MARK[i] ?? "", "blue");
    const info = right[i] ?? "";
    console.log(`  ${padAnsi(mark, MARK_WIDTH)}  ${info}`);
  }

  console.log(color(`  ${"─".repeat(WIDTH)}`, "gray"));
  console.log(`  ${color("Tu agente de desarrollo en la terminal.", "white")}`);
  console.log(
    `  ${color("Explora", "gray")} ${color("·", "blue")} ${color("Edita", "gray")} ${color("·", "blue")} ${color("Ejecuta", "gray")} ${color("·", "blue")} ${color("Verifica", "gray")} ${color("·", "blue")} ${color("Construye", "gray")}`
  );
  console.log(color(`  ${"─".repeat(WIDTH)}`, "gray"));
  console.log(
    `  ${color("/help", "white")}   ${color("/plan", "white")}   ${color("/build", "white")}   ${color("/status", "white")}   ${color("/clear", "white")}   ${color("/exit", "white")}` +
      `       ${color("Tab: alterna", "gray")}   ${color("Ctrl+L: limpiar", "gray")}   ${color("↑/↓: historial", "gray")}`
  );

  const modeLabel = mode === "plan" ? "PLAN" : "BUILD";
  const modeTone = mode === "plan" ? "green" : "blue";
  const prompt = `  ${color("●", "green")} ${color(modeLabel, modeTone)}  ${color(project, "blue")} ${color("›", "gray")} `;
  const branchText = `${color("⌘", "gray")} ${color(branch, "gray")}`;
  console.log(`${padAnsi(prompt, WIDTH - visibleLength(branchText) - 2)}${branchText}`);
}
