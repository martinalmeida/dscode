import { getEnvNumber } from "./env.js";

export const APP_CONSTANTS = {
  PRODUCT_NAME: "dscode",
  MAX_TOOL_ITERATIONS: getEnvNumber("DSCODE_MAX_TOOL_ITERATIONS", 30),
  MAX_FILE_READ_CHARS: getEnvNumber("DSCODE_MAX_FILE_READ_CHARS", 40000),
  MAX_TOOL_RESULT_CHARS: getEnvNumber("DSCODE_MAX_TOOL_RESULT_CHARS", 16000),
  MAX_RESPONSE_CHARS: 300,
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

export const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!\S)/,
  /:\(\)\{.*:\|:&.*\};:/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

export type ToolMode = "plan" | "build";
