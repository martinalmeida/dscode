import type { TaskState } from "../../app/agent/taskState.js";
import { classifyLLMError, type LLMErrorInfo } from "../llm/llmError.js";

export type RecoveryDecision = "retry" | "new_chat" | "compact_new_chat" | "pause" | "cancel";

export function recoveryInfo(error: unknown): LLMErrorInfo {
  return classifyLLMError(error);
}

export function buildRecoveryPack(
  task: TaskState,
  workspaceDir: string,
  lastTurn?: string
): string {
  return [
    "=== DSCODE TASK RECOVERY PACK ===",
    `task_id: ${task.id}`,
    `workspace: ${workspaceDir}`,
    `objective: ${task.objective}`,
    `phase: ${task.phase}`,
    `requires_edit: ${task.requiresEdit}`,
    `target_files: ${task.targetFiles.join(", ") || "none"}`,
    `inspected_files: ${task.inspectedFiles.slice(-30).join(", ") || "none"}`,
    `modified_files: ${task.modifiedFiles.join(", ") || "none"}`,
    `last_action: ${task.lastAction}`,
    `last_error: ${task.lastError || "none"}`,
    `verification: ${task.verification ? `${task.verification.passed ? "PASSED" : "FAILED"}: ${task.verification.summary}` : "pending"}`,
    task.plannedContext ? `planned_objective: ${task.plannedContext.objective}` : "",
    task.plannedContext ? `planned_summary: ${task.plannedContext.summary.slice(0, 12000)}` : "",
    `reads: ${task.counters.reads}`,
    `edits: ${task.counters.edits}`,
    `failures: ${task.counters.failures}`,
    lastTurn ? `last_turn_request: ${lastTurn}` : "",
    "RULE: Continue the existing task. Do not repeat completed mutations. Inspect the workspace when necessary before changing files.",
    "=== END DSCODE TASK RECOVERY PACK ===",
  ]
    .filter(Boolean)
    .join("\n");
}
