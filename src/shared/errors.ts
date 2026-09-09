export class AppError extends Error {
  readonly code: string;
  readonly statusCode?: number;

  constructor(message: string, code = "APP_ERROR", statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class WorkspaceError extends AppError {
  constructor(message: string) {
    super(message, "WORKSPACE_ERROR");
    this.name = "WorkspaceError";
  }
}

export class ToolError extends AppError {
  readonly toolName: string;
  constructor(toolName: string, message: string) {
    super(`[${toolName}] ${message}`, "TOOL_ERROR");
    this.name = "ToolError";
    this.toolName = toolName;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
    this.name = "ConfigError";
  }
}
