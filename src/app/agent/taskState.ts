export type AgentPhase =
  "understand" | "discover" | "inspect" | "edit" | "verify" | "repair" | "complete" | "failed";

export interface EditIntent {
  path: string;
  expectedHash: string | null;
  source: "read_snapshot" | "new_file";
}

export interface TaskState {
  id: string;
  objective: string;
  phase: AgentPhase;
  requiresEdit: boolean;
  targetFiles: string[];
  inspectedFiles: string[];
  readCounts: Record<string, number>;
  fileSnapshots: Record<string, string | null>;
  editIntent?: EditIntent;
  modifiedFiles: string[];
  lastAction: string;
  lastError?: string;
  verification?: { passed: boolean; summary: string };
  plannedContext?: { objective: string; summary: string; createdAt: string };
  counters: { reads: number; edits: number; failures: number; iterations: number };
}

const EDIT_INTENT =
  /\b(cambia|cambiar|edita|editar|modifica|modificar|arregla|arreglar|corrige|corregir|crea|crear|implementa|implementar|refactoriza|refactorizar|actualiza|actualizar|mejora|mejorar|elimina|eliminar|añade|agrega|agregar|replace|update|fix|refactor|implement|create|delete|remove|add)\b/i;
const QUESTION_INTENT =
  /^(qué|que|cuál|cual|cómo|como|dónde|donde|por qué|porque|explica|describe|muéstrame|muestrame|dime|which|what|how|where|why|show|explain)\b/i;
const ACTION_INTENT =
  /\b(monta|montar|baja|bajar|sube|subir|levanta|levantar|inicia|iniciar|reinicia|reiniciar|ejecuta|ejecutar|corre|correr|instala|instalar|desinstala|desinstalar|verifica|verificar|comprueba|comprobar|configura|configurar|detén|detener|detiene|arranca|arrancar|build|deploy|start|stop|restart|install|run|execute|verify|check)\b/i;

export function createTaskState(objective: string): TaskState {
  const requiresEdit =
    EDIT_INTENT.test(objective) ||
    ACTION_INTENT.test(objective) ||
    (/landing|front|ui|código|codigo|archivo|proyecto/i.test(objective) &&
      !QUESTION_INTENT.test(objective.trim()));
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    objective,
    phase: requiresEdit ? "understand" : "inspect",
    requiresEdit,
    targetFiles: [],
    inspectedFiles: [],
    readCounts: {},
    fileSnapshots: {},
    modifiedFiles: [],
    lastAction: "task_created",
    counters: { reads: 0, edits: 0, failures: 0, iterations: 0 },
  };
}

import { APP_CONSTANTS } from "../../shared/constants.js";

export function buildTaskAnchor(state: TaskState, workspaceDir: string): string {
  return [
    "=== DSCODE TASK STATE ===",
    `task_id: ${state.id}`,
    `workspace: ${workspaceDir}`,
    `objective: ${state.objective}`,
    `phase: ${state.phase}`,
    `requires_edit: ${state.requiresEdit}`,
    `target_files: ${state.targetFiles.join(", ") || "none"}`,
    `inspected_files: ${state.inspectedFiles.slice(-12).join(", ") || "none"}`,
    `modified_files: ${state.modifiedFiles.join(", ") || "none"}`,
    `last_action: ${state.lastAction}`,
    `last_error: ${state.lastError || "none"}`,
    `iterations: ${state.counters.iterations}`,
    `reads: ${state.counters.reads}`,
    `read_budget: ${state.counters.reads}/${APP_CONSTANTS.MAX_TOTAL_READS}`,
    state.plannedContext
      ? [
          `planned_objective: ${state.plannedContext.objective}`,
          `planned_at: ${state.plannedContext.createdAt}`,
          "planned_summary:",
          state.plannedContext.summary.slice(0, 6000),
        ].join("\n")
      : "planned_context: none",
        state.editIntent
      ? `edit_intent: ${state.editIntent.path} expected_hash=${state.editIntent.expectedHash ?? "<missing>"}`
      : "edit_intent: none",
    `edits: ${state.counters.edits}`,
    state.verification
      ? `verification: ${state.verification.passed ? "PASSED" : "FAILED"} — ${state.verification.summary}`
      : "verification: pending",
    "",
    state.requiresEdit && ["understand", "discover", "inspect"].includes(state.phase)
      ? "Regla: descubre e inspecciona solo lo necesario. En cuanto tengas el contexto suficiente, la siguiente respuesta debe ser un único tool call de edición."
      : "Regla: sigue el objetivo y no repitas herramientas sin una razón concreta.",
    state.phase === "edit"
      ? "Regla EDIT: la siguiente respuesta debe ser exactamente una herramienta de mutación válida; no expliques antes."
      : "",
    state.phase === "complete"
      ? "Regla COMPLETE: no hagas más cambios. Responde con un resumen breve de lo realizado y las verificaciones."
      : "",
    "=== END DSCODE TASK STATE ===",
  ]
    .filter(Boolean)
    .join("\n");
}
