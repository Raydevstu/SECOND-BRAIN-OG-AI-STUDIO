import { db } from '@/lib/db.stub';
import { registry } from '@/lib/tools/registry';
import { setKnowledgePort, type KnowledgePort } from '@/lib/tools/builtin';

let kp: KnowledgePort | null = null;

export const bindUndoPort = (p: KnowledgePort): void => {
  kp = p;
  setKnowledgePort(p);
};

export type SkippedCheckpoint = {
  id: string;
  tool: string;
  targetId: string;
  reason: string;
};

/** D13: Roll back all checkpoints for a run, newest first, using registered tool.undo handlers only. */
export async function undoRun(runId: string): Promise<{
  restored: string[];
  skipped: SkippedCheckpoint[];
}> {
  if (!kp) throw new Error('port not bound');
  const cps = await db.checkpoint.findMany({
    where: { runId, restoredAt: null },
    orderBy: { stepIdx: 'desc' },
  });
  const restored: string[] = [];
  const skipped: SkippedCheckpoint[] = [];

  for (const cp of cps) {
    const tool = registry.get(cp.tool);
    if (!tool || !tool.undo) {
      skipped.push({
        id: cp.id,
        tool: cp.tool,
        targetId: cp.targetId,
        reason: !tool ? 'unknown tool' : 'no undo handler registered',
      });
      continue;
    }
    const before: unknown = JSON.parse(cp.beforeJson);
    await tool.undo(before, cp.targetId);
    await db.checkpoint.update({ where: { id: cp.id }, data: { restoredAt: new Date() } });
    restored.push(cp.targetId);
  }

  return { restored, skipped };
}
