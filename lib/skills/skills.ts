import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { registry } from '@/lib/tools/registry';

export const SKILL_NAME_REGEX = /^[a-z0-9-]{1,48}$/;

function getSkillsDir(): string {
  return process.env.CORTEX_SKILLS_DIR ?? path.resolve(process.cwd(), 'skills');
}

function resolveSkillFile(name: string): string {
  if (!SKILL_NAME_REGEX.test(name)) {
    throw new Error(`Invalid skill name '${name}'`);
  }
  const base = path.resolve(getSkillsDir());
  const target = path.resolve(base, name, 'SKILL.md');
  if (!target.startsWith(base + path.sep)) {
    throw new Error('Skill path escapes skills directory');
  }
  return target;
}

export async function skillCatalog(allowed: string[]): Promise<{ name: string; description: string }[]> {
  const out: { name: string; description: string }[] = [];
  for (const name of allowed) {
    if (!SKILL_NAME_REGEX.test(name)) continue;
    try {
      const raw = await fs.readFile(resolveSkillFile(name), 'utf8');
      out.push({
        name,
        description: String(matter(raw).data.description ?? '').slice(0, 200),
      });
    } catch {
      /* missing skill ignored */
    }
  }
  return out;
}

registry.register({
  name: 'skill.load',
  description: 'Load the full instructions of a skill by name.',
  risk: 'read',
  input: z.object({ name: z.string().regex(SKILL_NAME_REGEX) }),
  run: async ({ name }) => {
    const raw = await fs.readFile(resolveSkillFile(name), 'utf8');
    return matter(raw).content.slice(0, 20_000);
  },
});
