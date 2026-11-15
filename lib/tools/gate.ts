import crypto from 'node:crypto';
import { db } from '@/lib/db.stub';
import type { ToolDef } from './registry';

export type Decision = { decision: 'allow' | 'ask' | 'deny'; reason: string };

export type GateAgent = {
  id: string;
  tools: string[];
  mcpServers?: string[];
  permissions: {
    fs: 'none' | 'read-only' | 'project-only';
    network: boolean;
    shell: 'deny' | 'ask' | 'allow';
  };
  memory: { read: string[]; write: string[] };
  delegation: { canSpawn: boolean };
};

function hasToolGrant(agentTools: string[], toolName: string): boolean {
  if (agentTools.includes(toolName)) return true;
  const parts = toolName.split('.');
  if (agentTools.includes(`${parts[0]}.*`)) return true;
  if (parts.length >= 3 && agentTools.includes(`${parts[0]}.${parts[1]}.*`)) return true;
  return false;
}

/** Pure decision. Deny wins. Anything not explicitly permitted is denied or asked. */
export function decide(agent: GateAgent, tool: ToolDef, opts: { preApproved?: boolean } = {}): Decision {
  if (!hasToolGrant(agent.tools, tool.name)) {
    return { decision: 'deny', reason: 'tool not granted to agent' };
  }

  // D8: MCP tools (mcp.<server>.<tool>) require <server> in agent.mcpServers AND network:true
  if (tool.name.startsWith('mcp.')) {
    const match = /^mcp\.([^.]+)\..+$/.exec(tool.name);
    const server = match?.[1];
    if (!server || !(agent.mcpServers ?? []).includes(server)) {
      return {
        decision: 'deny',
        reason: `MCP server '${server ?? 'unknown'}' not granted to agent`,
      };
    }
    if (!agent.permissions.network) {
      return { decision: 'deny', reason: 'network disabled' };
    }
  }

  if (tool.scope) {
    const list = tool.risk === 'write' ? agent.memory.write : agent.memory.read;
    if (!list.includes(tool.scope)) {
      return { decision: 'deny', reason: `memory scope '${tool.scope}' not permitted` };
    }
  }

  switch (tool.risk) {
    case 'read':
      return { decision: 'allow', reason: 'read-only tool' };
    case 'write':
      if (agent.permissions.fs === 'none' && !tool.scope) {
        return { decision: 'deny', reason: 'writes disabled' };
      }
      return opts.preApproved
        ? { decision: 'allow', reason: 'user approved' }
        : { decision: 'ask', reason: 'write needs approval' };
    case 'network':
      if (!agent.permissions.network) {
        return { decision: 'deny', reason: 'network disabled' };
      }
      return opts.preApproved
        ? { decision: 'allow', reason: 'user approved' }
        : { decision: 'ask', reason: 'network needs approval' };
    case 'shell':
      if (agent.permissions.shell === 'deny') {
        return { decision: 'deny', reason: 'shell denied' };
      }
      if (agent.permissions.shell === 'allow' || opts.preApproved) {
        return { decision: 'allow', reason: 'shell permitted' };
      }
      return { decision: 'ask', reason: 'shell needs approval' };
    case 'spawn':
      return agent.delegation.canSpawn
        ? { decision: 'allow', reason: 'delegation permitted' }
        : { decision: 'deny', reason: 'spawning disabled' };
  }
}

export async function audit(
  runId: string,
  agentId: string,
  tool: string,
  d: Decision,
  args: unknown
) {
  const argsHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(args ?? null))
    .digest('hex')
    .slice(0, 16);
  await db.permissionAudit.create({
    data: { runId, agentId, tool, decision: d.decision, reason: d.reason, argsHash },
  });
}
