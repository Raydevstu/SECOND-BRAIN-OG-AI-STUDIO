import { z, type ZodTypeAny } from 'zod';

export type Risk = 'read' | 'write' | 'network' | 'shell' | 'spawn';

export type ToolCtx = { runId: string; agentId: string; projectId?: string | null };

export type ToolDef<S extends ZodTypeAny = ZodTypeAny> = {
  name: string; // e.g. "brain.search"
  description: string;
  risk: Risk;
  input: S;
  /** Memory scope this tool touches, for scope checks. */
  scope?: 'personal' | 'project' | 'knowledge' | 'agent';
  /** Return state needed to undo this call. Called BEFORE run for write tools. */
  snapshot?: (args: z.infer<S>, ctx: ToolCtx) => Promise<{ targetId: string; before: unknown } | null>;
  /** D13: Registered snapshot restore handler for undoRun. */
  undo?: (before: unknown, targetId: string) => Promise<void>;
  run: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown>;
};

class Registry {
  private tools = new Map<string, ToolDef>();

  register<S extends ZodTypeAny>(t: ToolDef<S>) {
    if (this.tools.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
    this.tools.set(t.name, t as unknown as ToolDef);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }
}

export const registry = new Registry();
