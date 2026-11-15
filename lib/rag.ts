import type { BrainItem, ChatCitation, GraphEdge, GraphNode, WikiPage } from './types';

export interface RagRetrievalResult {
  citations: ChatCitation[];
  contextPrompt: string;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function scoreText(tokens: string[], fields: Array<{ text: string; weight: number }>): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const field of fields) {
    const lower = field.text.toLowerCase();
    for (const token of tokens) {
      if (lower.includes(token)) {
        total += field.weight;
      }
    }
  }
  return total;
}

/**
 * Hybrid retrieval across Brain items, LLM Wiki pages, and Knowledge Graph hops.
 * Enforces project isolation when activeProjectId is supplied.
 */
export function retrieveHybridContext(params: {
  query: string;
  brainItems: BrainItem[];
  wikiPages: WikiPage[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  activeProjectId?: string | null;
  includeBrain?: boolean;
  includeWiki?: boolean;
  limit?: number;
}): RagRetrievalResult {
  const {
    query,
    brainItems,
    wikiPages,
    graphNodes,
    graphEdges,
    activeProjectId = null,
    includeBrain = true,
    includeWiki = true,
    limit = 6,
  } = params;

  const tokens = tokenize(query);
  const candidates: Array<{
    id: string;
    title: string;
    sourceType: 'brain' | 'wiki' | 'graph';
    score: number;
    snippet: string;
  }> = [];

  if (includeBrain) {
    for (const item of brainItems) {
      if (activeProjectId && item.projectId && item.projectId !== activeProjectId) continue;
      let score = scoreText(tokens, [
        { text: item.title, weight: 4 },
        { text: item.tags.join(' '), weight: 3 },
        { text: item.folder, weight: 2 },
        { text: item.content, weight: 1.5 },
      ]);
      if (activeProjectId && item.projectId === activeProjectId) score += 1.5;
      if (score > 0) {
        candidates.push({
          id: item.id,
          title: item.title,
          sourceType: 'brain',
          score,
          snippet: `[Brain · ${item.folder}] ${item.title}: ${item.content.slice(0, 320)}`,
        });
      }
    }
  }

  if (includeWiki) {
    for (const page of wikiPages) {
      if (activeProjectId && page.projectId && page.projectId !== activeProjectId) continue;
      const score = scoreText(tokens, [
        { text: page.title, weight: 4.5 },
        { text: page.category, weight: 2.5 },
        { text: page.summary, weight: 2 },
        { text: page.content, weight: 1.5 },
      ]);
      if (score > 0) {
        candidates.push({
          id: page.id,
          title: page.title,
          sourceType: 'wiki',
          score,
          snippet: `[Wiki · ${page.category}] ${page.title}: ${page.summary} (${page.citations.join(', ')})`,
        });
      }
    }
  }

  // Graph hop expansion
  for (const node of graphNodes) {
    if (activeProjectId && node.projectId && node.projectId !== activeProjectId) continue;
    const score = scoreText(tokens, [
      { text: node.label, weight: 4 },
      { text: node.type, weight: 1.5 },
      { text: node.summary, weight: 2 },
    ]);
    if (score > 0) {
      const connected = graphEdges
        .filter((e) => e.source === node.id || e.target === node.id)
        .slice(0, 4)
        .map((e) => {
          const otherId = e.source === node.id ? e.target : e.source;
          const other = graphNodes.find((n) => n.id === otherId);
          return other ? `${e.relation} ${other.label}` : '';
        })
        .filter(Boolean);
      candidates.push({
        id: node.id,
        title: `${node.label} (${node.type})`,
        sourceType: 'graph',
        score: score + connected.length * 0.5,
        snippet: `[Graph · ${node.type}] ${node.label}: ${node.summary}${connected.length ? ` · Relations: ${connected.join('; ')}` : ''}`,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);

  return {
    citations: top.map((c) => ({
      id: c.id,
      title: c.title,
      sourceType: c.sourceType,
      score: Math.round(c.score * 10) / 10,
    })),
    contextPrompt:
      top.length > 0
        ? top.map((c, idx) => `(${idx + 1}) ${c.snippet}`).join('\n')
        : 'No matching vault, wiki, or graph entries found for this query.',
  };
}
