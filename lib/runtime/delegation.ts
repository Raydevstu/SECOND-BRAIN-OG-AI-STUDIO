import type { RunnableAgent } from './types';

export const GLOBAL_MAX_DEPTH = 3;

export const ACTIVE_CHILD_STATUSES = [
  'running',
  'planning',
  'awaiting_tool',
  'awaiting_plan',
];

export type DelegationCheckResult =
  | { ok: true; childDepth: number }
  | { ok: false; reason: string };

/**
 * D4: Single pure enforcement point for delegation & depth bounds.
 * Child depth = parent depth + 1, capped at min(agent.delegation.maxDepth, GLOBAL_MAX_DEPTH).
 */
export function checkDelegation(
  agent: Pick<RunnableAgent, 'delegation'>,
  parentRun: { depth: number },
  activeChildren: number,
  targetAgentId?: string
): DelegationCheckResult {
  if (!agent.delegation.canSpawn) {
    return { ok: false, reason: 'spawning disabled' };
  }
  if (targetAgentId !== undefined && !agent.delegation.allowed.includes(targetAgentId)) {
    return { ok: false, reason: 'not allowed' };
  }
  if (activeChildren >= agent.delegation.maxConcurrent) {
    return { ok: false, reason: 'maxConcurrent limit' };
  }
  const childDepth = parentRun.depth + 1;
  const maxDepth = Math.min(agent.delegation.maxDepth, GLOBAL_MAX_DEPTH);
  if (childDepth > maxDepth) {
    return { ok: false, reason: 'depth limit' };
  }
  return { ok: true, childDepth };
}
