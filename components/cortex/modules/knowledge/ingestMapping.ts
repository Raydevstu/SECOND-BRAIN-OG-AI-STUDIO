// REAL APP: the server performs this mapping.

import type {
  BrainFolder,
  BrainItem,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelation,
  WikiPage,
} from '@/lib/types';
import { computeEntityNodePosition, computeSourceNodePlacement } from './graphLayout';

const VALID_FOLDERS: readonly BrainFolder[] = [
  'Memories',
  'Ideas',
  'Notes',
  'Goals',
  'Tasks',
  'People',
  'Bookmarks',
  'Journal',
];

const VALID_WIKI_CATEGORIES: readonly WikiPage['category'][] = [
  'Models',
  'Providers',
  'Frameworks',
  'Agents',
  'Prompting',
  'RAG',
  'Vector DBs',
  'MCP Servers',
  'Tutorials',
];

const VALID_NODE_TYPES: readonly GraphNodeType[] = [
  'Person',
  'Project',
  'Document',
  'Prompt',
  'Agent',
  'Workflow',
  'Model',
  'Concept',
];

const VALID_RELATIONS: readonly GraphRelation[] = [
  'USES',
  'OWNS',
  'RELATES_TO',
  'BUILT_WITH',
  'REFERENCES',
  'DEPENDS_ON',
];

export interface LibrarianEntityResult {
  label: string;
  nodeType: string;
  relation: string;
  summary: string;
}

export interface LibrarianPipelineResult {
  title: string;
  folder: string;
  summary: string;
  tags: string[];
  wikiCategory: string;
  wikiTopicTitle: string;
  wikiMarkdown: string;
  entities?: LibrarianEntityResult[];
}

export interface MapLibrarianIngestInput {
  result: LibrarianPipelineResult;
  redactedContent: string;
  projectId: string | null;
  existingGraphNodes: GraphNode[];
  timestampMs: number;
  updatedAtIso: string;
}

export interface MapLibrarianIngestOutput {
  brainItem: BrainItem;
  wikiPage: WikiPage;
  nodes: GraphNode[];
  edges: GraphEdge[];
  validFolder: BrainFolder;
}

export function mapLibrarianResultToKnowledge({
  result,
  redactedContent,
  projectId,
  existingGraphNodes,
  timestampMs,
  updatedAtIso,
}: MapLibrarianIngestInput): MapLibrarianIngestOutput {
  const brainId = `brain-${timestampMs}`;
  const validFolder: BrainFolder = VALID_FOLDERS.includes(result.folder as BrainFolder)
    ? (result.folder as BrainFolder)
    : 'Notes';

  const brainItem: BrainItem = {
    id: brainId,
    title: result.title,
    folder: validFolder,
    projectId,
    tags: result.tags,
    content: `${result.summary}\n\n---\n\n${redactedContent}`,
    backlinks: [],
    updatedAt: updatedAtIso,
    source: 'Librarian Agent',
  };

  const wikiId = `wiki-${timestampMs}`;
  const validWikiCategory: WikiPage['category'] = VALID_WIKI_CATEGORIES.includes(
    result.wikiCategory as WikiPage['category']
  )
    ? (result.wikiCategory as WikiPage['category'])
    : 'Frameworks';

  const wikiPage: WikiPage = {
    id: wikiId,
    title: result.wikiTopicTitle,
    category: validWikiCategory,
    projectId,
    summary: result.summary,
    content: result.wikiMarkdown,
    citations: [brainId],
    updatedAt: updatedAtIso,
    compiledBy: 'Librarian',
  };

  const sourceNodeId = `node-${timestampMs}`;
  const sourceLabel = result.title.slice(0, 28);
  const sourcePlacement = computeSourceNodePlacement(sourceLabel);

  const sourceNode: GraphNode = {
    id: sourceNodeId,
    label: sourceLabel,
    type: 'Document',
    projectId,
    summary: result.summary,
    x: sourcePlacement.x,
    y: sourcePlacement.y,
  };

  const nodes: GraphNode[] = [sourceNode];
  const edges: GraphEdge[] = [
    {
      id: `edge-lib-${timestampMs}`,
      source: 'node-librarian',
      target: sourceNodeId,
      relation: 'RELATES_TO',
      weight: 1,
    },
  ];

  const nodeIdByLabel = new Map<string, string>();
  for (const existing of existingGraphNodes) {
    const key = existing.label.trim().toLowerCase();
    if (key && !nodeIdByLabel.has(key)) {
      nodeIdByLabel.set(key, existing.id);
    }
  }
  const sourceLabelKey = sourceLabel.trim().toLowerCase();
  if (sourceLabelKey) {
    nodeIdByLabel.set(sourceLabelKey, sourceNodeId);
  }

  const seenEdgeKeys = new Set<string>();

  (result.entities ?? []).forEach((ent, idx) => {
    const trimmedLabel = ent.label.trim();
    if (!trimmedLabel) return;
    const normalizedLabel = trimmedLabel.toLowerCase();

    const existingId = nodeIdByLabel.get(normalizedLabel);
    const targetId = existingId ?? `node-ent-${timestampMs}-${idx}`;

    if (!existingId) {
      nodeIdByLabel.set(normalizedLabel, targetId);
      const pos = computeEntityNodePosition(sourcePlacement, trimmedLabel, idx);
      const validType: GraphNodeType = VALID_NODE_TYPES.includes(ent.nodeType as GraphNodeType)
        ? (ent.nodeType as GraphNodeType)
        : 'Concept';
      nodes.push({
        id: targetId,
        label: trimmedLabel,
        type: validType,
        projectId,
        summary: ent.summary || trimmedLabel,
        x: pos.x,
        y: pos.y,
      });
    }

    if (targetId !== sourceNodeId) {
      const validRelation: GraphRelation = VALID_RELATIONS.includes(ent.relation as GraphRelation)
        ? (ent.relation as GraphRelation)
        : 'REFERENCES';

      const edgeKey = `${sourceNodeId}->${targetId}:${validRelation}`;
      if (!seenEdgeKeys.has(edgeKey)) {
        seenEdgeKeys.add(edgeKey);
        edges.push({
          id: `edge-ent-${timestampMs}-${idx}`,
          source: sourceNodeId,
          target: targetId,
          relation: validRelation,
          weight: 1,
        });
      }
    }
  });

  return {
    brainItem,
    wikiPage,
    nodes,
    edges,
    validFolder,
  };
}
