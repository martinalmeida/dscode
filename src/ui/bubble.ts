import { color, truncateLine } from "./theme.js";

export function printUserBubble(text: string): void {
  const lines = String(text ?? "").split("\n");
  console.log("");
  lines.forEach((line, index) => {
    const prefix = index === 0 ? color("› Tú", "blue") : color("  │", "blue");
    console.log(`${prefix} ${line}`);
  });
}

export function printAgentBubble(text: string): void {
  const lines = String(text ?? "").split("\n");
  console.log("");
  lines.forEach((line, index) => {
    const prefix = index === 0 ? color("◆ dscode", "magenta") : color("│", "magenta");
    console.log(`${prefix} ${line}`);
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
  process.stdout.write(`${color("  ·", "yellow")} ${color(name, "white")}${suffix}\n`);
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
  console.log(`${color("✖", "red")} ${color(truncateLine(text, 140), "red")}`);
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
