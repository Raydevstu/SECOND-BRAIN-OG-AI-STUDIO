import type { ChatResult, Msg } from '@/lib/providers/router';
import { router } from '@/lib/providers';

export const estimateTokens = (m: Msg[]): number =>
  Math.ceil(m.reduce((n, x) => n + x.content.length, 0) / 4);

/** Keep system + first user message + last `keep` turns. Summarize the middle. */
export async function compact(
  messages: Msg[],
  opts: { maxTokens: number; keep?: number; privacy: 'local-only' | 'any' }
): Promise<{ messages: Msg[]; compacted: boolean; usage: ChatResult | null }> {
  if (estimateTokens(messages) <= opts.maxTokens) {
    return { messages, compacted: false, usage: null };
  }
  const keep = Math.max(1, opts.keep ?? 6);
  const head = messages.slice(0, 2);
  const tail = messages.slice(-keep);
  const middle = messages.slice(2, messages.length - keep);
  if (middle.length === 0) {
    return { messages, compacted: false, usage: null };
  }
  const r = await router.chat(
    { task: 'summarize', privacy: opts.privacy },
    [
      {
        role: 'system',
        content:
          'Summarize this agent transcript. Keep: decisions, facts found, tool results that matter, open questions. Under 300 words.',
      },
      {
        role: 'user',
        content: middle.map((m) => `${m.role}: ${m.content.slice(0, 2000)}`).join('\n'),
      },
    ]
  );
  return {
    messages: [
      ...head,
      { role: 'user' as const, content: `[Summary of earlier steps]\n${r.text}` },
      ...tail,
    ],
    compacted: true,
    usage: r,
  };
}
