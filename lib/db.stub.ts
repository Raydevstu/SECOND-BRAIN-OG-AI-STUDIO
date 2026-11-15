// STAND-IN: replace in the real repo
// In-memory Prisma-compatible store for AgentRun, RunStep, Checkpoint, Artifact, PermissionAudit.
// Mode B stand-in: replace imports of '@/lib/db.stub' with the real Prisma client in OBA-ultimate.

import crypto from 'node:crypto';

export type AgentRunStatus =
  | 'planning'
  | 'awaiting_plan'
  | 'running'
  | 'awaiting_tool'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface AgentRunRecord {
  id: string;
  agentId: string;
  parentRunId: string | null;
  depth: number;
  projectId: string | null;
  task: string;
  status: string;
  plan: string | null;
  budgetJson: string;
  stateJson: string;
  tokensUsed: number;
  costUsd: number;
  result: string | null;
  error: string | null;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunStepRecord {
  id: string;
  runId: string;
  idx: number;
  kind: string;
  name: string | null;
  inputJson: string;
  outputJson: string;
  decision: string | null;
  tokens: number;
  costUsd: number;
  latencyMs: number;
  createdAt: Date;
}

export interface CheckpointRecord {
  id: string;
  runId: string;
  stepIdx: number;
  tool: string;
  targetId: string;
  beforeJson: string;
  restoredAt: Date | null;
  createdAt: Date;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  key: string;
  version: number;
  title: string;
  kind: string;
  content: string;
  createdAt: Date;
}

export interface PermissionAuditRecord {
  id: string;
  runId: string;
  agentId: string;
  tool: string;
  decision: string;
  reason: string;
  argsHash: string;
  createdAt: Date;
}

export type AgentRunWithRelations = AgentRunRecord & {
  steps?: RunStepRecord[];
  artifacts?: ArtifactRecord[];
  checkpoints?: CheckpointRecord[];
};

type StringFilter = string | { in: string[] };
type LockedUntilClause = { lockedUntil?: null | { lt: Date } };

export interface AgentRunWhere {
  id?: string;
  parentRunId?: string | null;
  status?: StringFilter;
  OR?: LockedUntilClause[];
}

export interface AgentRunInclude {
  steps?: boolean | { orderBy?: { idx: 'asc' | 'desc' } };
  artifacts?: boolean;
  checkpoints?: boolean;
}

type NumericFieldUpdate = number | { increment: number };

export interface AgentRunUpdateData {
  status?: string;
  plan?: string | null;
  budgetJson?: string;
  stateJson?: string;
  tokensUsed?: NumericFieldUpdate;
  costUsd?: NumericFieldUpdate;
  result?: string | null;
  error?: string | null;
  lockedUntil?: Date | null;
  updatedAt?: Date;
}

function cuidLike(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function matchesStringFilter(val: string, filter?: StringFilter): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return val === filter;
  return filter.in.includes(val);
}

function matchesRunWhere(run: AgentRunRecord, where: AgentRunWhere): boolean {
  if (where.id !== undefined && run.id !== where.id) return false;
  if (where.parentRunId !== undefined && run.parentRunId !== where.parentRunId) return false;
  if (!matchesStringFilter(run.status, where.status)) return false;
  if (where.OR && where.OR.length > 0) {
    const anyMatch = where.OR.some((clause) => {
      if (clause.lockedUntil === null) return run.lockedUntil === null;
      if (clause.lockedUntil && typeof clause.lockedUntil === 'object' && 'lt' in clause.lockedUntil) {
        return run.lockedUntil !== null && run.lockedUntil.getTime() < clause.lockedUntil.lt.getTime();
      }
      return false;
    });
    if (!anyMatch) return false;
  }
  return true;
}

function applyNumericUpdate(current: number, update: NumericFieldUpdate | undefined): number {
  if (update === undefined) return current;
  if (typeof update === 'number') return update;
  return current + update.increment;
}

class InMemoryRuntimeDb {
  private runs = new Map<string, AgentRunRecord>();
  private steps: RunStepRecord[] = [];
  private checkpoints = new Map<string, CheckpointRecord>();
  private artifacts: ArtifactRecord[] = [];
  private audits: PermissionAuditRecord[] = [];

  reset() {
    this.runs.clear();
    this.steps = [];
    this.checkpoints.clear();
    this.artifacts = [];
    this.audits = [];
  }

  private attachRelations(run: AgentRunRecord, include?: AgentRunInclude): AgentRunWithRelations {
    const base: AgentRunWithRelations = { ...run };
    if (!include) return base;
    if (include.steps) {
      const dir = typeof include.steps === 'object' && include.steps.orderBy?.idx === 'desc' ? -1 : 1;
      base.steps = this.steps
        .filter((s) => s.runId === run.id)
        .sort((a, b) => (a.idx - b.idx) * dir)
        .map((s) => ({ ...s }));
    }
    if (include.artifacts) {
      base.artifacts = this.artifacts
        .filter((a) => a.runId === run.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((a) => ({ ...a }));
    }
    if (include.checkpoints) {
      base.checkpoints = [...this.checkpoints.values()]
        .filter((c) => c.runId === run.id)
        .sort((a, b) => a.stepIdx - b.stepIdx)
        .map((c) => ({ ...c }));
    }
    return base;
  }

  agentRun = {
    create: async ({
      data,
    }: {
      data: {
        id?: string;
        agentId: string;
        parentRunId?: string | null;
        depth?: number;
        projectId?: string | null;
        task: string;
        status: string;
        plan?: string | null;
        budgetJson: string;
        stateJson?: string;
        tokensUsed?: number;
        costUsd?: number;
        result?: string | null;
        error?: string | null;
        lockedUntil?: Date | null;
      };
    }): Promise<AgentRunRecord> => {
      const now = new Date();
      const record: AgentRunRecord = {
        id: data.id ?? cuidLike('run'),
        agentId: data.agentId,
        parentRunId: data.parentRunId ?? null,
        depth: data.depth ?? 0,
        projectId: data.projectId ?? null,
        task: data.task,
        status: data.status,
        plan: data.plan ?? null,
        budgetJson: data.budgetJson,
        stateJson: data.stateJson ?? '{}',
        tokensUsed: data.tokensUsed ?? 0,
        costUsd: data.costUsd ?? 0,
        result: data.result ?? null,
        error: data.error ?? null,
        lockedUntil: data.lockedUntil ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.runs.set(record.id, record);
      return { ...record };
    },

    findUnique: async ({
      where,
      include,
    }: {
      where: { id: string };
      include?: AgentRunInclude;
    }): Promise<AgentRunWithRelations | null> => {
      const run = this.runs.get(where.id);
      if (!run) return null;
      return this.attachRelations(run, include);
    },

    findUniqueOrThrow: async ({
      where,
      include,
    }: {
      where: { id: string };
      include?: AgentRunInclude;
    }): Promise<AgentRunWithRelations> => {
      const run = this.runs.get(where.id);
      if (!run) throw new Error(`AgentRun '${where.id}' not found`);
      return this.attachRelations(run, include);
    },

    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: AgentRunUpdateData;
    }): Promise<AgentRunRecord> => {
      const run = this.runs.get(where.id);
      if (!run) throw new Error(`AgentRun '${where.id}' not found`);
      const updated: AgentRunRecord = {
        ...run,
        status: data.status !== undefined ? data.status : run.status,
        plan: data.plan !== undefined ? data.plan : run.plan,
        budgetJson: data.budgetJson !== undefined ? data.budgetJson : run.budgetJson,
        stateJson: data.stateJson !== undefined ? data.stateJson : run.stateJson,
        tokensUsed: applyNumericUpdate(run.tokensUsed, data.tokensUsed),
        costUsd: applyNumericUpdate(run.costUsd, data.costUsd),
        result: data.result !== undefined ? data.result : run.result,
        error: data.error !== undefined ? data.error : run.error,
        lockedUntil: data.lockedUntil !== undefined ? data.lockedUntil : run.lockedUntil,
        updatedAt: data.updatedAt ?? new Date(),
      };
      this.runs.set(updated.id, updated);
      return { ...updated };
    },

    updateMany: async ({
      where,
      data,
    }: {
      where: AgentRunWhere;
      data: AgentRunUpdateData;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const [id, run] of this.runs.entries()) {
        if (!matchesRunWhere(run, where)) continue;
        const updated: AgentRunRecord = {
          ...run,
          status: data.status !== undefined ? data.status : run.status,
          plan: data.plan !== undefined ? data.plan : run.plan,
          budgetJson: data.budgetJson !== undefined ? data.budgetJson : run.budgetJson,
          stateJson: data.stateJson !== undefined ? data.stateJson : run.stateJson,
          tokensUsed: applyNumericUpdate(run.tokensUsed, data.tokensUsed),
          costUsd: applyNumericUpdate(run.costUsd, data.costUsd),
          result: data.result !== undefined ? data.result : run.result,
          error: data.error !== undefined ? data.error : run.error,
          lockedUntil: data.lockedUntil !== undefined ? data.lockedUntil : run.lockedUntil,
          updatedAt: data.updatedAt ?? new Date(),
        };
        this.runs.set(id, updated);
        count += 1;
      }
      return { count };
    },

    count: async ({ where }: { where: AgentRunWhere }): Promise<number> => {
      let n = 0;
      for (const run of this.runs.values()) {
        if (matchesRunWhere(run, where)) n += 1;
      }
      return n;
    },
  };

  runStep = {
    create: async ({
      data,
    }: {
      data: {
        runId: string;
        idx: number;
        kind: string;
        name?: string | null;
        inputJson: string;
        outputJson: string;
        decision?: string | null;
        tokens?: number;
        costUsd?: number;
        latencyMs?: number;
      };
    }): Promise<RunStepRecord> => {
      if (!this.runs.has(data.runId)) {
        throw new Error(`RunStep foreign key failed: AgentRun '${data.runId}' not found`);
      }
      if (this.steps.some((s) => s.runId === data.runId && s.idx === data.idx)) {
        throw new Error(`Unique constraint failed on RunStep (runId=${data.runId}, idx=${data.idx})`);
      }
      const record: RunStepRecord = {
        id: cuidLike('step'),
        runId: data.runId,
        idx: data.idx,
        kind: data.kind,
        name: data.name ?? null,
        inputJson: data.inputJson,
        outputJson: data.outputJson,
        decision: data.decision ?? null,
        tokens: data.tokens ?? 0,
        costUsd: data.costUsd ?? 0,
        latencyMs: data.latencyMs ?? 0,
        createdAt: new Date(),
      };
      this.steps.push(record);
      return { ...record };
    },

    update: async ({
      where,
      data,
    }: {
      where: { runId_idx: { runId: string; idx: number } };
      data: Partial<Pick<RunStepRecord, 'outputJson' | 'decision' | 'tokens' | 'costUsd' | 'latencyMs'>>;
    }): Promise<RunStepRecord> => {
      const idx = this.steps.findIndex(
        (s) => s.runId === where.runId_idx.runId && s.idx === where.runId_idx.idx
      );
      if (idx === -1) {
        throw new Error(`RunStep (${where.runId_idx.runId}, ${where.runId_idx.idx}) not found`);
      }
      const updated: RunStepRecord = {
        ...this.steps[idx],
        outputJson: data.outputJson !== undefined ? data.outputJson : this.steps[idx].outputJson,
        decision: data.decision !== undefined ? data.decision : this.steps[idx].decision,
        tokens: data.tokens !== undefined ? data.tokens : this.steps[idx].tokens,
        costUsd: data.costUsd !== undefined ? data.costUsd : this.steps[idx].costUsd,
        latencyMs: data.latencyMs !== undefined ? data.latencyMs : this.steps[idx].latencyMs,
      };
      this.steps[idx] = updated;
      return { ...updated };
    },

    findMany: async ({
      where,
      orderBy,
    }: {
      where?: { runId?: string };
      orderBy?: { idx: 'asc' | 'desc' };
    } = {}): Promise<RunStepRecord[]> => {
      const dir = orderBy?.idx === 'desc' ? -1 : 1;
      return this.steps
        .filter((s) => (where?.runId !== undefined ? s.runId === where.runId : true))
        .sort((a, b) => (a.idx - b.idx) * dir)
        .map((s) => ({ ...s }));
    },
  };

  checkpoint = {
    create: async ({
      data,
    }: {
      data: {
        runId: string;
        stepIdx: number;
        tool: string;
        targetId: string;
        beforeJson: string;
        restoredAt?: Date | null;
      };
    }): Promise<CheckpointRecord> => {
      if (!this.runs.has(data.runId)) {
        throw new Error(`Checkpoint foreign key failed: AgentRun '${data.runId}' not found`);
      }
      const record: CheckpointRecord = {
        id: cuidLike('cp'),
        runId: data.runId,
        stepIdx: data.stepIdx,
        tool: data.tool,
        targetId: data.targetId,
        beforeJson: data.beforeJson,
        restoredAt: data.restoredAt ?? null,
        createdAt: new Date(),
      };
      this.checkpoints.set(record.id, record);
      return { ...record };
    },

    findMany: async ({
      where,
      orderBy,
    }: {
      where?: { runId?: string; restoredAt?: null };
      orderBy?: { stepIdx: 'asc' | 'desc' };
    } = {}): Promise<CheckpointRecord[]> => {
      const dir = orderBy?.stepIdx === 'desc' ? -1 : 1;
      return [...this.checkpoints.values()]
        .filter((c) => {
          if (where?.runId !== undefined && c.runId !== where.runId) return false;
          if (where?.restoredAt === null && c.restoredAt !== null) return false;
          return true;
        })
        .sort((a, b) => (a.stepIdx - b.stepIdx) * dir)
        .map((c) => ({ ...c }));
    },

    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { restoredAt?: Date | null };
    }): Promise<CheckpointRecord> => {
      const cp = this.checkpoints.get(where.id);
      if (!cp) throw new Error(`Checkpoint '${where.id}' not found`);
      const updated: CheckpointRecord = {
        ...cp,
        restoredAt: data.restoredAt !== undefined ? data.restoredAt : cp.restoredAt,
      };
      this.checkpoints.set(updated.id, updated);
      return { ...updated };
    },
  };

  artifact = {
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: { runId: string; key: string };
      orderBy?: { version: 'asc' | 'desc' };
    }): Promise<ArtifactRecord | null> => {
      const dir = orderBy?.version === 'asc' ? 1 : -1;
      const matches = this.artifacts
        .filter((a) => a.runId === where.runId && a.key === where.key)
        .sort((a, b) => (a.version - b.version) * dir);
      return matches[0] ? { ...matches[0] } : null;
    },

    create: async ({
      data,
    }: {
      data: {
        runId: string;
        key: string;
        version: number;
        title: string;
        kind: string;
        content: string;
      };
    }): Promise<ArtifactRecord> => {
      if (!this.runs.has(data.runId)) {
        throw new Error(`Artifact foreign key failed: AgentRun '${data.runId}' not found`);
      }
      if (
        this.artifacts.some(
          (a) => a.runId === data.runId && a.key === data.key && a.version === data.version
        )
      ) {
        throw new Error(
          `Unique constraint failed on Artifact (runId=${data.runId}, key=${data.key}, version=${data.version})`
        );
      }
      const record: ArtifactRecord = {
        id: cuidLike('art'),
        runId: data.runId,
        key: data.key,
        version: data.version,
        title: data.title,
        kind: data.kind,
        content: data.content,
        createdAt: new Date(),
      };
      this.artifacts.push(record);
      return { ...record };
    },
  };

  permissionAudit = {
    create: async ({
      data,
    }: {
      data: {
        runId: string;
        agentId: string;
        tool: string;
        decision: string;
        reason: string;
        argsHash: string;
      };
    }): Promise<PermissionAuditRecord> => {
      const record: PermissionAuditRecord = {
        id: cuidLike('aud'),
        runId: data.runId,
        agentId: data.agentId,
        tool: data.tool,
        decision: data.decision,
        reason: data.reason,
        argsHash: data.argsHash,
        createdAt: new Date(),
      };
      this.audits.push(record);
      return { ...record };
    },

    findMany: async ({
      where,
    }: {
      where?: { runId?: string };
    } = {}): Promise<PermissionAuditRecord[]> => {
      return this.audits
        .filter((a) => (where?.runId !== undefined ? a.runId === where.runId : true))
        .map((a) => ({ ...a }));
    },
  };
}

const globalForRuntimeDb = globalThis as unknown as {
  __cortexRuntimeDbStub?: InMemoryRuntimeDb;
};

export const db = globalForRuntimeDb.__cortexRuntimeDbStub ?? new InMemoryRuntimeDb();
if (!globalForRuntimeDb.__cortexRuntimeDbStub) {
  globalForRuntimeDb.__cortexRuntimeDbStub = db;
}
