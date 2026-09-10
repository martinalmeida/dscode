export const APP_CONSTANTS = {
  PRODUCT_NAME: "dscode",
  MAX_TOOL_ITERATIONS: 15,
  MAX_FILE_READ_CHARS: 20000,
  MAX_TOOL_RESULT_CHARS: 8000,
  MAX_RESPONSE_CHARS: 300,
  COMMAND_TIMEOUT_MS: 60_000,
  SEARCH_TIMEOUT_MS: 30_000,
  IGNORED_DIRS: new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]),
  AGENT_CONTEXT_DIR_NAMES: [".agent", "agents", ".deepseek"] as const,
  MAX_DEPTH_FOR_NESTED_AGENTS_MD: 3,
} as const;

export const READ_ONLY_TOOLS = new Set<string>(["read_file", "list_directory", "search_files"]);

export const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!\S)/,
  /:\(\)\{.*:\|:&.*\};:/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

export const CONFIRM_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\bmv\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+checkout\s+--/,
  /\bgit\s+clean\b/,
  /\bgit\s+push\s+.*--force/,
  />\s*[^&]/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
];

export type ToolMode = "plan" | "build";
