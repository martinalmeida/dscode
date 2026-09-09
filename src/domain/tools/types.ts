import type { Logger } from "../../infrastructure/logger/logger.js";

export type ToolMode = "plan" | "build";

export interface ToolContext {
  workspaceDir: string;
  mode?: ToolMode;
  logger?: Logger;
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
