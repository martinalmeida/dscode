import { color, displayWidth, terminalWidth, truncateLine, wrapText } from "./theme.js";

function printWrapped(prefix: string, text: string, options?: { continuationPrefix?: string }): void {
  const continuationPrefix = options?.continuationPrefix ?? prefix.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ");
  const firstPrefixWidth = Math.max(1, displayWidth(prefix) + 1);
  const continuationPrefixWidth = Math.max(1, displayWidth(continuationPrefix) + 1);
  const width = terminalWidth();
  const first = wrapText(text, Math.max(1, width - firstPrefixWidth));

  if (first.length === 0) {
    console.log(prefix);
    return;
  }

  console.log(`${prefix} ${first[0]}`);
  for (const line of first.slice(1)) {
    console.log(`${continuationPrefix} ${wrapText(line, Math.max(1, width - continuationPrefixWidth))[0] ?? ""}`);
  }
}

export function printUserBubble(text: string): void {
  console.log("");
  const lines = String(text ?? "").split("\n");
  lines.forEach((line, index) => {
    const prefix = index === 0 ? color("› Tú", "blue") : color("  │", "blue");
    printWrapped(prefix, line, { continuationPrefix: color("  │", "blue") });
  });
}

export function printAgentBubble(text: string): void {
  console.log("");
  const lines = String(text ?? "").split("\n");
  lines.forEach((line, index) => {
    const prefix = index === 0 ? color("◆ dscode", "magenta") : color("│", "magenta");
    printWrapped(prefix, line, { continuationPrefix: color("│", "magenta") });
  });
  console.log("");
}

export function printToolCall(name: string, args = ""): void {
  const details = truncateLine(args.replace(/^\{\s*"path"\s*:\s*"([^"]+)".*$/i, "$1"), 88);
  const suffix =
    details && details !== args
      ? ` ${color(details, "gray")}`
      : args
        ? ` ${color(truncateLine(args, 72), "gray")}`
        : "";
  const line = `${color("  ·", "yellow")} ${color(name, "white")}${suffix}`;
  const max = Math.max(20, terminalWidth());
  if (line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").length <= max) {
    process.stdout.write(`${line}\n`);
  } else {
    const plainPrefix = `  · ${name}`;
    const detailWidth = Math.max(12, max - plainPrefix.length - 1);
    process.stdout.write(`${color("  ·", "yellow")} ${color(name, "white")}`);
    if (details || args) {
      const value = details || truncateLine(args, 72);
      for (const part of wrapText(value, detailWidth)) {
        process.stdout.write(` ${color(part, "gray")}\n`);
      }
    } else {
      process.stdout.write("\n");
    }
  }
}

export function printToolResult(name: string, preview: string): void {
  const value = truncateLine(preview, 110);
  const lower = value.toLowerCase();
  if (/changed=true|verificad|passed|exit code: 0|estado: ok/.test(lower)) {
    console.log(`${color("  ✓", "green")} ${color(name, "gray")} ${color(value, "green")}`);
    return;
  }
  if (/error|fail|conflict|no se modific|no existe|exit code: [1-9]/.test(lower)) {
    console.log(`${color("  !", "red")} ${color(name, "gray")} ${color(value, "red")}`);
    return;
  }
  console.log(`${color("  ·", "gray")} ${color(name, "gray")} ${color(value, "dim")}`);
}

export function printStatusLine(input: {
  mode: "plan" | "build";
  projectName: string;
  workspace: string;
  phase?: string;
}): void {
  const mode = input.mode === "build" ? color("BUILD", "magenta") : color("PLAN", "green");
  const phase = input.phase ? ` ${color("·", "gray")} ${color(input.phase, "gray")}` : "";
  console.log(
    `${mode} ${color(input.projectName, "white")} ${color(input.workspace, "gray")}${phase}`
  );
}

export function printErrorBubble(text: string): void {
  const width = terminalWidth();
  const prefix = `${color("✖", "red")} `;
  const prefixWidth = 2;
  for (const line of wrapText(text, Math.max(1, width - prefixWidth))) {
    console.log(`${prefix}${color(line, "red")}`);
  }
}

export function printCommandHelp(): void {
  console.log("");
  console.log(color("Comandos", "white"));
  console.log(`  ${color("/help", "cyan")}     mostrar esta ayuda`);
  console.log(`  ${color("/status", "cyan")}   ver proyecto y modo actual`);
  console.log(`  ${color("/clear", "cyan")}    limpiar la terminal`);
  console.log(`  ${color("/plan", "cyan")}     cambiar a PLAN`);
  console.log(`  ${color("/build", "cyan")}    cambiar a BUILD`);
  console.log(`  ${color("/exit", "cyan")}     salir`);
  console.log("");
  console.log(color("Atajos", "white"));
  console.log(
    `  ${color("Tab", "cyan")} cambia PLAN/BUILD · ${color("↑/↓", "cyan")} historial · ${color("Ctrl+L", "cyan")} limpia pantalla`
  );
  console.log("");
}
