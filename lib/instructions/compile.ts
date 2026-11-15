import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_LAYER_CHARS = 12_000;
export const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export type CompiledInstructions = { text: string; hash: string; layers: string[] };

async function readIfExists(p: string): Promise<string | null> {
  try {
    return (await fs.readFile(p, 'utf8')).slice(0, MAX_LAYER_CHARS);
  } catch {
    return null;
  }
}

export const safeId = (s: string): string => {
  if (!PROJECT_ID_REGEX.test(s)) {
    throw new Error('bad id');
  }
  return s;
};

export async function compileInstructions(opts: {
  projectId?: string | null;
  agentPrompt: string;
}): Promise<CompiledInstructions> {
  const root = process.env.CORTEX_INSTRUCTIONS_DIR ?? path.resolve(process.cwd(), 'instructions');
  const layers: { name: string; body: string }[] = [];

  const g = await readIfExists(path.join(root, 'global.md'));
  if (g) layers.push({ name: 'global', body: g });

  if (opts.projectId) {
    const p = await readIfExists(path.join(root, 'projects', safeId(opts.projectId), 'AGENTS.md'));
    if (p) layers.push({ name: 'project', body: p });
  }

  layers.push({ name: 'agent', body: opts.agentPrompt.slice(0, MAX_LAYER_CHARS) });

  // later layers win on conflict: say so explicitly
  const text =
    layers.map((l) => `## Instructions (${l.name})\n${l.body.trim()}`).join('\n\n') +
    '\n\nIf layers conflict, the later layer wins. Never override safety limits given by the system.';
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  return { text, hash, layers: layers.map((l) => l.name) };
}

/** Export for other tools (Claude Code, Codex). */
export async function exportAgentsMd(projectId: string): Promise<string> {
  const c = await compileInstructions({ projectId, agentPrompt: '' });
  return c.text;
}
