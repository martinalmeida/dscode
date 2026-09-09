import { APP_CONSTANTS, READ_ONLY_TOOLS as CONST_READ_ONLY } from "../../shared/constants.js";

export type AgentMode = "plan" | "build";

export const READ_ONLY_TOOLS: Set<string> = CONST_READ_ONLY;
export const MAX_TOOL_ITERATIONS: number = APP_CONSTANTS.MAX_TOOL_ITERATIONS;
