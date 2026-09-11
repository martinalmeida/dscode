import { color } from "./theme.js";

export function printBanner(
  opts: { compact?: boolean; version?: string; projectName?: string } = {}
): void {
  const version = opts.version ? ` ${opts.version}` : "";
  const project = opts.projectName ? ` · ${opts.projectName}` : "";
  console.log("");
  console.log(
    `${color("dscode", "magenta")} ${color(version.trim(), "dim")}${color(project, "gray")} ${color("• AI coding agent", "dim")}`.trim()
  );
  console.log(
    color("────────────────────────────────────────────────────────────────────────", "gray")
  );
}
