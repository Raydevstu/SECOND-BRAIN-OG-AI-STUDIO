import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registry } from '../lib/tools/registry';
import { skillCatalog } from '../lib/skills/skills';
import { compact, estimateTokens } from '../lib/runtime/compact';
import type { Msg } from '../lib/providers/router';

async function withFakeFetch(impl: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

async function main() {
  const tmpSkills = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-step4-skills-'));
  const prevSkillsDir = process.env.CORTEX_SKILLS_DIR;
  process.env.CORTEX_SKILLS_DIR = tmpSkills;

  try {
    // Create a valid skill and an external SKILL.md outside tmpSkills for traversal tests
    await fs.mkdir(path.join(tmpSkills, 'code-review'), { recursive: true });
    await fs.writeFile(
      path.join(tmpSkills, 'code-review', 'SKILL.md'),
      `---\nname: code-review\ndescription: Review TypeScript PRs carefully.\n---\n\nAlways inspect error handling and edge cases.\n`,
      'utf8'
    );
    const outsideDir = path.join(tmpSkills, '..', path.basename(tmpSkills) + '-outside');
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, 'SKILL.md'), 'SECRET_OUTSIDE_SKILL', 'utf8');

    // 1. skillCatalog skips invalid skill names and path traversal, loads valid ones
    const catalog = await skillCatalog(['../x', 'Bad_Name', 'foo/bar', 'missing-skill', 'code-review']);
    assert.deepEqual(catalog, [
      { name: 'code-review', description: 'Review TypeScript PRs carefully.' },
    ]);

    // 2. skill.load rejects invalid skill names and path traversal via input schema & runtime guard
    const skillLoad = registry.get('skill.load')!;
    assert.ok(skillLoad, 'skill.load must be registered');

    for (const bad of ['../x', `../${path.basename(outsideDir)}`, 'BadName', 'a/b', '', 'a'.repeat(49)]) {
      const parsed = skillLoad.input.safeParse({ name: bad });
      assert.equal(parsed.success, false, `expected skill.load input schema to reject '${bad}'`);
      await assert.rejects(
        () => skillLoad.run({ name: bad }, { runId: 'r1', agentId: 'a1' }),
        /Invalid skill name/
      );
    }

    const loaded = await skillLoad.run({ name: 'code-review' }, { runId: 'r1', agentId: 'a1' });
    assert.equal(String(loaded).trim(), 'Always inspect error handling and edge cases.');

    await fs.rm(outsideDir, { recursive: true, force: true });

    // 3. No compaction under the threshold
    const shortMsgs: Msg[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'step 1' },
      { role: 'user', content: 'obs 1' },
    ];
    let fetchCalls = 0;
    await withFakeFetch(
      async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
      async () => {
        const res = await compact(shortMsgs, {
          maxTokens: estimateTokens(shortMsgs) + 10,
          keep: 2,
          privacy: 'local-only',
        });
        assert.equal(res.compacted, false);
        assert.equal(res.usage, null);
        assert.deepEqual(res.messages, shortMsgs);
        assert.equal(fetchCalls, 0);
      }
    );

    // 4. Compaction keeps head and tail and replaces the middle with a summary
    const longMsgs: Msg[] = [
      { role: 'system', content: 'SYSTEM_HEAD' },
      { role: 'user', content: 'USER_HEAD' },
      { role: 'assistant', content: 'MID_1 ' + 'x'.repeat(200) },
      { role: 'user', content: 'MID_2 ' + 'y'.repeat(200) },
      { role: 'assistant', content: 'MID_3 ' + 'z'.repeat(200) },
      { role: 'user', content: 'TAIL_1' },
      { role: 'assistant', content: 'TAIL_2' },
    ];
    await withFakeFetch(
      async (_input, init) => {
        fetchCalls += 1;
        const body = JSON.parse(String(init?.body)) as { messages: Msg[] };
        const userPayload = body.messages[1].content;
        assert.ok(userPayload.includes('MID_1'));
        assert.ok(userPayload.includes('MID_2'));
        assert.ok(userPayload.includes('MID_3'));
        assert.ok(!userPayload.includes('SYSTEM_HEAD'));
        assert.ok(!userPayload.includes('TAIL_2'));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Key decisions and facts summarized.' } }],
            usage: { prompt_tokens: 80, completion_tokens: 12 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      async () => {
        const res = await compact(longMsgs, { maxTokens: 50, keep: 2, privacy: 'local-only' });
        assert.equal(fetchCalls, 1);
        assert.equal(res.compacted, true);
        assert.ok(res.usage);
        assert.equal(res.messages.length, 5); // 2 head + 1 summary + 2 tail
        assert.deepEqual(res.messages[0], longMsgs[0]);
        assert.deepEqual(res.messages[1], longMsgs[1]);
        assert.equal(res.messages[2].role, 'user');
        assert.equal(res.messages[2].content, '[Summary of earlier steps]\nKey decisions and facts summarized.');
        assert.deepEqual(res.messages[3], longMsgs[5]);
        assert.deepEqual(res.messages[4], longMsgs[6]);
      }
    );

    console.log('verify-step4: all assertions passed');
  } finally {
    if (prevSkillsDir === undefined) delete process.env.CORTEX_SKILLS_DIR;
    else process.env.CORTEX_SKILLS_DIR = prevSkillsDir;
    await fs.rm(tmpSkills, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
