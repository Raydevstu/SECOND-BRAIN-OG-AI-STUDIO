import { z } from 'zod';
import { registry } from './registry';

export interface KnowledgePort {
  search(q: string, k: number): Promise<{ id: string; title: string; snippet: string }[]>;
  getNote(id: string): Promise<{ id: string; title: string; body: string } | null>;
  updateNote(id: string, body: string): Promise<void>;
  createNote(title: string, body: string): Promise<{ id: string }>;
}

let port: KnowledgePort | null = null;
export const setKnowledgePort = (p: KnowledgePort) => {
  port = p;
};
const kp = (): KnowledgePort => {
  if (!port) throw new Error('KnowledgePort not configured');
  return port;
};

registry.register({
  name: 'brain.search',
  description: 'Search the second brain. Returns ids, titles, snippets.',
  risk: 'read',
  scope: 'knowledge',
  input: z.object({
    query: z.string().min(1).max(300),
    k: z.number().int().min(1).max(10).default(5),
  }),
  run: async ({ query, k }) => kp().search(query, k),
});

registry.register({
  name: 'brain.get',
  description: 'Read one note by id.',
  risk: 'read',
  scope: 'knowledge',
  input: z.object({ id: z.string().max(100) }),
  run: async ({ id }) => kp().getNote(id),
});

registry.register({
  name: 'brain.update',
  description: "Replace a note's body.",
  risk: 'write',
  scope: 'project',
  input: z.object({ id: z.string().max(100), body: z.string().max(50_000) }),
  snapshot: async ({ id }) => {
    const n = await kp().getNote(id);
    return n ? { targetId: id, before: n.body } : null;
  },
  undo: async (before, targetId) => {
    await kp().updateNote(targetId, String(before));
  },
  run: async ({ id, body }) => {
    await kp().updateNote(id, body);
    return { ok: true };
  },
});

registry.register({
  name: 'artifact.save',
  description: 'Save a document, code or diagram as a versioned artifact.',
  risk: 'read',
  input: z.object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().max(120),
    kind: z.enum(['markdown', 'code', 'mermaid']),
    content: z.string().max(100_000),
  }),
  run: async (a, ctx) => {
    const { db } = await import('@/lib/db.stub');
    const last = await db.artifact.findFirst({
      where: { runId: ctx.runId, key: a.key },
      orderBy: { version: 'desc' },
    });
    const row = await db.artifact.create({
      data: { ...a, runId: ctx.runId, version: (last?.version ?? 0) + 1 },
    });
    return { id: row.id, version: row.version };
  },
});
