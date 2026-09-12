import { getEnvNumber } from "./env.js";

export const APP_CONSTANTS = {
  PRODUCT_NAME: "dscode",
  MAX_TOOL_ITERATIONS: getEnvNumber("DSCODE_MAX_TOOL_ITERATIONS", 40),
  MAX_FILE_READ_CHARS: getEnvNumber("DSCODE_MAX_FILE_READ_CHARS", 40000),
  MAX_TOOL_RESULT_CHARS: getEnvNumber("DSCODE_MAX_TOOL_RESULT_CHARS", 24000),
  MAX_READS_PER_FILE: getEnvNumber("DSCODE_MAX_READS_PER_FILE", 4),
  MAX_TOTAL_READS: getEnvNumber("DSCODE_MAX_TOTAL_READS", 12),
  MAX_LLM_ATTEMPTS: getEnvNumber("DSCODE_MAX_LLM_ATTEMPTS", 3),
  CONTEXT_WARNING_CHARS: getEnvNumber("DSCODE_CONTEXT_WARNING_CHARS", 90000),
  CONTEXT_CRITICAL_CHARS: getEnvNumber("DSCODE_CONTEXT_CRITICAL_CHARS", 120000),
  COMMAND_TIMEOUT_MS: getEnvNumber("DSCODE_COMMAND_TIMEOUT_MS", 60_000),
  SEARCH_TIMEOUT_MS: getEnvNumber("DSCODE_SEARCH_TIMEOUT_MS", 30_000),
  GLOB_LIMIT: getEnvNumber("DSCODE_GLOB_LIMIT", 200),
  READ_MANY_LIMIT: getEnvNumber("DSCODE_READ_MANY_LIMIT", 40),
  IGNORED_DIRS: new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".cache",
    "vendor",
    "__pycache__",
    ".venv",
    ".bundle",
  ]),
  AGENT_CONTEXT_DIR_NAMES: [".agent", "agents", ".deepseek"] as const,
} as const;

// AVISO: esto es una lista negra por regex, no un sandbox. run_command corre con
// shell:true (execa), así que cualquier blocklist basada en texto es evitable por
// alguien que quiera evadirla a propósito (variables, $(), base64, etc.). Su único
// propósito real es frenar los patrones MÁS obvios y accidentales, no ser una
// defensa de seguridad real contra comandos adversarios — eso requeriría un
// sandbox de verdad (contenedor, seccomp, allowlist), fuera del alcance de dscode.
export const BLOCKED_PATTERNS: RegExp[] = [
  // rm -rf / (o -fr, o --recursive --force) contra la raíz o raíz/*, en cualquier
  // orden de flags. Antes solo cubría "-rf" exacto y no "/*"("/*" seguía siendo
  // no-bloqueado porque el lookahead exigía que nada siguiera a la "/").
  /\brm\s+(?:-\w*[rR]\w*[fF]\w*|-\w*[fF]\w*[rR]\w*|--recursive\s+--force|--force\s+--recursive)\s+\/\*?(?!\S)/,
  /:\(\)\{.*:\|:&.*\};:/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

export type ToolMode = "plan" | "build";
