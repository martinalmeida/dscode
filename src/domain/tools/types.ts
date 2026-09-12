import type { Logger } from "../../infrastructure/logger/logger.js";

export type ToolMode = "plan" | "build";

export interface ToolContext {
  workspaceDir: string;
  taskObjective?: string;
  mode?: ToolMode;
  logger?: Logger;
  pauseInput?: () => void;
  resumeInput?: () => void;
  pauseSpinner?: () => void;
  resumeSpinner?: (msg?: string) => void;
}

export type ToolResult = string;

export interface ToolDefinition<TArgs = unknown> {
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly schema: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
      };
    };
  };
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}
