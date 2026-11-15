import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileInstructions, exportAgentsMd, MAX_LAYER_CHARS } from '../lib/instructions/compile';

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-step1-'));
  const prevDir = process.env.CORTEX_INSTRUCTIONS_DIR;
  process.env.CORTEX_INSTRUCTIONS_DIR = tmpRoot;

  try {
    // 1. Missing files are skipped cleanly
    const missingRes = await compileInstructions({
      projectId: 'nonexistent-proj',
      agentPrompt: 'Agent only rule.',
    });
    assert.deepEqual(missingRes.layers, ['agent']);
    assert.ok(missingRes.text.includes('## Instructions (agent)\nAgent only rule.'));

    // 2. Later layers appear last (global -> project -> agent)
    await fs.writeFile(path.join(tmpRoot, 'global.md'), 'GLOBAL_RULE', 'utf8');
    await fs.mkdir(path.join(tmpRoot, 'projects', 'proj_1'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'projects', 'proj_1', 'AGENTS.md'), 'PROJECT_RULE', 'utf8');

    const ordered = await compileInstructions({
      projectId: 'proj_1',
      agentPrompt: 'AGENT_RULE',
    });
    assert.deepEqual(ordered.layers, ['global', 'project', 'agent']);
    const idxGlobal = ordered.text.indexOf('GLOBAL_RULE');
    const idxProject = ordered.text.indexOf('PROJECT_RULE');
    const idxAgent = ordered.text.indexOf('AGENT_RULE');
    assert.ok(idxGlobal !== -1 && idxProject > idxGlobal && idxAgent > idxProject, 'later layers must appear last');

    // 3. Hash is stable for the same input and changes when content changes
    const orderedRepeat = await compileInstructions({
      projectId: 'proj_1',
      agentPrompt: 'AGENT_RULE',
    });
    assert.equal(ordered.hash, orderedRepeat.hash);
    assert.equal(ordered.hash.length, 16);

    const changed = await compileInstructions({
      projectId: 'proj_1',
      agentPrompt: 'AGENT_RULE_MODIFIED',
    });
    assert.notEqual(ordered.hash, changed.hash);

    // 4. Bad projectId throws
    for (const badId of ['../escape', 'a/b', 'has space', 'x'.repeat(65), 'bad$id']) {
      await assert.rejects(
        () => compileInstructions({ projectId: badId, agentPrompt: 'AGENT_RULE' }),
        /bad id/,
        `expected bad projectId '${badId}' to throw`
      );
    }

    // 5. Layers are truncated at 12,000 characters
    const longGlobal = 'G'.repeat(MAX_LAYER_CHARS) + 'GLOBAL_OVERFLOW';
    const longProject = 'P'.repeat(MAX_LAYER_CHARS) + 'PROJECT_OVERFLOW';
    const longAgent = 'A'.repeat(MAX_LAYER_CHARS) + 'AGENT_OVERFLOW';

    await fs.writeFile(path.join(tmpRoot, 'global.md'), longGlobal, 'utf8');
    await fs.writeFile(path.join(tmpRoot, 'projects', 'proj_1', 'AGENTS.md'), longProject, 'utf8');

    const truncated = await compileInstructions({
      projectId: 'proj_1',
      agentPrompt: longAgent,
    });
    assert.ok(!truncated.text.includes('GLOBAL_OVERFLOW'), 'global layer must truncate at 12,000 chars');
    assert.ok(!truncated.text.includes('PROJECT_OVERFLOW'), 'project layer must truncate at 12,000 chars');
    assert.ok(!truncated.text.includes('AGENT_OVERFLOW'), 'agent layer must truncate at 12,000 chars');

    // Verify exact 12,000-character body kept for each layer
    assert.ok(truncated.text.includes(`## Instructions (global)\n${'G'.repeat(MAX_LAYER_CHARS)}`));
    assert.ok(truncated.text.includes(`## Instructions (project)\n${'P'.repeat(MAX_LAYER_CHARS)}`));
    assert.ok(truncated.text.includes(`## Instructions (agent)\n${'A'.repeat(MAX_LAYER_CHARS)}`));

    // 6. exportAgentsMd includes global + project layers
    const exported = await exportAgentsMd('proj_1');
    assert.ok(exported.includes('## Instructions (global)'));
    assert.ok(exported.includes('## Instructions (project)'));

    console.log('verify-step1: all assertions passed');
  } finally {
    if (prevDir === undefined) delete process.env.CORTEX_INSTRUCTIONS_DIR;
    else process.env.CORTEX_INSTRUCTIONS_DIR = prevDir;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
