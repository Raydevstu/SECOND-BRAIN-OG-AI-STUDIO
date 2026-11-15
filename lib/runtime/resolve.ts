import { db } from '@/lib/db.stub';
import { registry } from '@/lib/tools/registry';
import { decide, audit } from '@/lib/tools/gate';
import { loadRunnableAgent } from '@/lib/agents/load.stub';
import type { RunState } from './types';
import { advance, executeTool, parseRunState } from './runtime';

/** Human approves/rejects the plan. */
export async function resolvePlan(runId: string, approve: boolean, editedPlan?: string): Promise<void> {
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== 'awaiting_plan') throw new Error('not awaiting plan');
  if (!approve) {
    await db.agentRun.update({ where: { id: runId }, data: { status: 'cancelled' } });
    return;
  }
  await db.agentRun.update({
    where: { id: runId },
    data: { status: 'running', plan: (editedPlan ?? run.plan ?? '').slice(0, 8000) },
  });
  await advance(runId);
}

/** Human approves/rejects a pending tool call. Re-checks the gate and validates args server-side (D7). */
export async function resolveTool(runId: string, approve: boolean): Promise<void> {
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== 'awaiting_tool') throw new Error('not awaiting tool');

  const st: RunState = parseRunState(run.stateJson);
  const p = st.pending;
  if (!p) throw new Error('no pending call');

  const failRun = async (error: string) => {
    await db.agentRun.update({
      where: { id: runId },
      data: { status: 'failed', error, stateJson: JSON.stringify({ ...st, pending: undefined }) },
    });
  };

  // D7: null-check agent and tool; fail the run cleanly instead of crashing.
  let agent;
  try {
    agent = await loadRunnableAgent(run.agentId);
  } catch (e) {
    await failRun(`Cannot resolve pending tool: ${(e as Error).message}`);
    return;
  }
  const tool = registry.get(p.tool);
  if (!tool) {
    await failRun(`Pending tool '${p.tool}' is not registered`);
    return;
  }

  // D7: re-validate stored args against tool.input schema before executing.
  const parsedArgs = tool.input.safeParse(p.args);
  if (!parsedArgs.success) {
    const errMsg = `Invalid stored args for '${tool.name}': ${parsedArgs.error.issues.map((i) => i.message).join('; ')}`;
    await db.runStep.update({
      where: { runId_idx: { runId, idx: p.stepIdx } },
      data: { outputJson: JSON.stringify({ error: errMsg }), decision: 'deny' },
    });
    await failRun(errMsg);
    return;
  }

  const ctx = { runId, agentId: agent.id, projectId: st.projectId ?? run.projectId ?? null };
  let output: unknown = { error: 'rejected by user' };
  let decision: 'allow' | 'deny' = 'deny';

  if (approve) {
    const d = decide(agent, tool, { preApproved: true });
    await audit(runId, agent.id, tool.name, d, parsedArgs.data);
    if (d.decision === 'allow') {
      decision = 'allow';
      output = await executeTool(tool.name, parsedArgs.data, ctx, p.stepIdx);
    } else {
      output = { error: d.reason };
    }
  }

  // Replace the pending step with the real result
  await db.runStep.update({
    where: { runId_idx: { runId, idx: p.stepIdx } },
    data: { outputJson: JSON.stringify(output), decision },
  });
  await db.agentRun.update({
    where: { id: runId },
    data: { status: 'running', stateJson: JSON.stringify({ ...st, pending: undefined }) },
  });
  await advance(runId);
}

export async function cancelRun(runId: string): Promise<void> {
  await db.agentRun.updateMany({
    where: {
      id: runId,
      status: { in: ['planning', 'running', 'awaiting_plan', 'awaiting_tool'] },
    },
    data: { status: 'cancelled' },
  });
}
