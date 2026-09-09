import { createLogger } from "../../infrastructure/logger/logger.js";
import type { ToolDefinition, ToolMode } from "./types.js";

const log = createLogger("tools:registry");

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private frozen = false;

  freeze(): void {
    this.frozen = true;
  }

  register(def: ToolDefinition): void {
    if (this.frozen) throw new Error(`ToolRegistry congelado — no se puede registrar "${def.name}" tras freeze()`);
    if (this.tools.has(def.name)) {
      log.warn({ tool: def.name }, `Tool duplicada "${def.name}" — se ignora registro posterior`);
      return;
    }
    // validación mínima
    if (!def.name || !/^[a-z0-9_]+$/.test(def.name)) {
      throw new Error(`Tool name inválido: "${def.name}" (debe ser snake_case)`);
    }
    this.tools.set(def.name, def);
    log.debug({ tool: def.name, readOnly: def.readOnly }, "Tool registrada");
  }

  registerAll(defs: ToolDefinition[]): void { for (const d of defs) this.register(d); }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }

  getAll(): ToolDefinition[] { return [...this.tools.values()]; }

  getSchemas(): Array<ToolDefinition["schema"]> { return this.getAll().map((t) => t.schema); }

  getSchemasForMode(mode: ToolMode): Array<ToolDefinition["schema"]> {
    if (mode === "plan") return this.getAll().filter((t) => t.readOnly).map((t) => t.schema);
    return this.getSchemas();
  }

  getExecutors(): Record<string, ToolDefinition["execute"]> {
    return Object.fromEntries(this.getAll().map((t) => [t.name, t.execute.bind(t)]));
  }

  has(name: string): boolean { return this.tools.has(name); }

  size(): number { return this.tools.size; }
}
