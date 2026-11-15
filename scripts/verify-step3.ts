import assert from 'node:assert/strict';
import { z } from 'zod';
import { db } from '../lib/db.stub';
import { registry, type ToolDef } from '../lib/tools/registry';
import { decide, audit, type GateAgent } from '../lib/tools/gate';
import { setKnowledgePort } from '../lib/tools/builtin';

function makeAgent(overrides: Partial<GateAgent> = {}): GateAgent {
  return {
    id: 'agent-test',
    tools: ['brain.*'],
    mcpServers: [],
    permissions: { fs: 'project-only', network: false, shell: 'deny' },
    memory: { read: ['knowledge'], write: ['project'] },
    delegation: { canSpawn: false },
    ...overrides,
  };
}

function fakeTool(partial: Partial<ToolDef> & { name: string; risk: ToolDef['risk'] }): ToolDef {
  return {
    description: 'test tool',
    input: z.object({}),
    run: async () => ({ ok: true }),
    ...partial,
  };
}

async function main() {
  db.reset();

  const brainSearch = registry.get('brain.search')!;
  const brainUpdate = registry.get('brain.update')!;
  assert.ok(brainSearch, 'brain.search must be registered');
  assert.ok(brainUpdate, 'brain.update must be registered');
  assert.equal(typeof brainUpdate.undo, 'function', 'D13: brain.update must define undo');

  // 1. Not-granted denies
  const noTools = makeAgent({ tools: [] });
  assert.equal(decide(noTools, brainSearch).decision, 'deny');

  // 2. Wildcard "brain.*" works
  const wildcardAgent = makeAgent({ tools: ['brain.*'] });
  assert.equal(decide(wildcardAgent, brainSearch).decision, 'allow');

  // 3. Scope mismatch denies
  const badReadScope = makeAgent({ memory: { read: ['personal'], write: ['project'] } });
  assert.equal(decide(badReadScope, brainSearch).decision, 'deny');
  const badWriteScope = makeAgent({ memory: { read: ['knowledge'], write: ['personal'] } });
  assert.equal(decide(badWriteScope, brainUpdate).decision, 'deny');

  // 4. Read allows
  assert.equal(decide(wildcardAgent, brainSearch).decision, 'allow');

  // 5. Write and network ask, and preApproved allows
  assert.equal(decide(wildcardAgent, brainUpdate).decision, 'ask');
  assert.equal(decide(wildcardAgent, brainUpdate, { preApproved: true }).decision, 'allow');

  const netTool = fakeTool({ name: 'web.fetch', risk: 'network' });
  const netDisabled = makeAgent({ tools: ['web.fetch'], permissions: { fs: 'none', network: false, shell: 'deny' } });
  assert.equal(decide(netDisabled, netTool).decision, 'deny');

  const netEnabled = makeAgent({ tools: ['web.fetch'], permissions: { fs: 'none', network: true, shell: 'deny' } });
  assert.equal(decide(netEnabled, netTool).decision, 'ask');
  assert.equal(decide(netEnabled, netTool, { preApproved: true }).decision, 'allow');

  // 6. Shell deny always denies (even with preApproved), shell ask asks, shell allow allows
  const shellTool = fakeTool({ name: 'shell.exec', risk: 'shell' });
  const shellDeny = makeAgent({ tools: ['shell.exec'], permissions: { fs: 'none', network: false, shell: 'deny' } });
  assert.equal(decide(shellDeny, shellTool).decision, 'deny');
  assert.equal(decide(shellDeny, shellTool, { preApproved: true }).decision, 'deny');

  const shellAsk = makeAgent({ tools: ['shell.exec'], permissions: { fs: 'none', network: false, shell: 'ask' } });
  assert.equal(decide(shellAsk, shellTool).decision, 'ask');
  assert.equal(decide(shellAsk, shellTool, { preApproved: true }).decision, 'allow');

  const shellAllow = makeAgent({ tools: ['shell.exec'], permissions: { fs: 'none', network: false, shell: 'allow' } });
  assert.equal(decide(shellAllow, shellTool).decision, 'allow');

  // 7. Spawn follows canSpawn
  const spawnTool = fakeTool({ name: 'agent.delegate', risk: 'spawn' });
  assert.equal(decide(makeAgent({ tools: ['agent.delegate'], delegation: { canSpawn: false } }), spawnTool).decision, 'deny');
  assert.equal(decide(makeAgent({ tools: ['agent.delegate'], delegation: { canSpawn: true } }), spawnTool).decision, 'allow');

  // 8. D8: MCP tool (mcp.<server>.<tool>) denied unless mcpServers includes <server> AND network is true
  const mcpTool = fakeTool({ name: 'mcp.github.search_issues', risk: 'network' });
  assert.equal(
    decide(
      makeAgent({
        tools: ['mcp.*'],
        mcpServers: [],
        permissions: { fs: 'none', network: true, shell: 'deny' },
      }),
      mcpTool
    ).decision,
    'deny',
    'D8: missing server in mcpServers must deny'
  );
  assert.equal(
    decide(
      makeAgent({
        tools: ['mcp.*'],
        mcpServers: ['github'],
        permissions: { fs: 'none', network: false, shell: 'deny' },
      }),
      mcpTool
    ).decision,
    'deny',
    'D8: network:false must deny MCP tool even when server is in mcpServers'
  );
  const mcpAllowed = makeAgent({
    tools: ['mcp.*'],
    mcpServers: ['github'],
    permissions: { fs: 'none', network: true, shell: 'deny' },
  });
  assert.equal(decide(mcpAllowed, mcpTool).decision, 'ask');
  assert.equal(decide(mcpAllowed, mcpTool, { preApproved: true }).decision, 'allow');

  // 9. Audit stores a hash only (assert no raw args in the row)
  const secretMarker = 'SUPER_SECRET_ARG_VALUE_DO_NOT_STORE';
  const d = decide(wildcardAgent, brainUpdate);
  await audit('run_audit_1', wildcardAgent.id, brainUpdate.name, d, {
    id: 'note-1',
    body: secretMarker,
  });
  const rows = await db.permissionAudit.findMany({ where: { runId: 'run_audit_1' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'ask');
  assert.equal(rows[0].argsHash.length, 16);
  assert.ok(!JSON.stringify(rows[0]).includes(secretMarker), 'raw args must never appear in audit row');

  // 10. Built-in snapshot + undo + artifact.save sanity check
  const notes = new Map<string, { id: string; title: string; body: string }>([
    ['n1', { id: 'n1', title: 'Test', body: 'original body' }],
  ]);
  setKnowledgePort({
    search: async () => [],
    getNote: async (id) => notes.get(id) ?? null,
    updateNote: async (id, body) => {
      const n = notes.get(id);
      if (n) n.body = body;
    },
    createNote: async (title, body) => {
      const id = `n-${notes.size + 1}`;
      notes.set(id, { id, title, body });
      return { id };
    },
  });
  const snap = await brainUpdate.snapshot!({ id: 'n1', body: 'new body' }, { runId: 'r1', agentId: 'a1' });
  assert.deepEqual(snap, { targetId: 'n1', before: 'original body' });
  await brainUpdate.run({ id: 'n1', body: 'new body' }, { runId: 'r1', agentId: 'a1' });
  assert.equal(notes.get('n1')?.body, 'new body');
  await brainUpdate.undo!(snap!.before, snap!.targetId);
  assert.equal(notes.get('n1')?.body, 'original body');

  console.log('verify-step3: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
