'use client';

import React, { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import {
  BookOpen,
  Brain,
  FilePlus2,
  GitBranch,
  Inbox,
  Loader2,
  Pin,
  Search,
  ShieldCheck,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { redactSecretsInText } from '@/lib/privacy-redactor';
import type {
  BrainFolder,
  BrainItem,
  CortexState,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelation,
  InspectorTarget,
  KnowledgeTab,
  RunLogEntry,
  WikiPage,
} from '@/lib/types';

interface KnowledgeModuleProps {
  state: CortexState;
  activeTab: KnowledgeTab;
  onTabChange: (tab: KnowledgeTab) => void;
  selectedBrainId: string;
  onSelectBrain: (id: string) => void;
  selectedWikiId: string;
  onSelectWiki: (id: string) => void;
  onAddBrainItem: (item: BrainItem) => void;
  onUpdateBrainItem: (id: string, patch: Partial<BrainItem>) => void;
  onUpsertWikiPage: (page: WikiPage) => void;
  onMergeGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  onAddLog: (entry: Omit<RunLogEntry, 'id' | 'timestamp'>) => void;
  onInspect: (target: InspectorTarget) => void;
}

const NODE_COLORS: Record<GraphNodeType, string> = {
  Project: '#6366f1',
  Document: '#10b981',
  Agent: '#f59e0b',
  Concept: '#0ea5e9',
  Model: '#ec4899',
  Workflow: '#f97316',
  Prompt: '#8b5cf6',
  Person: '#14b8a6',
};

const FOLDERS: BrainFolder[] = ['Memories', 'Ideas', 'Notes', 'Goals', 'Tasks', 'People', 'Bookmarks', 'Journal'];

export function KnowledgeModule({
  state,
  activeTab,
  onTabChange,
  selectedBrainId,
  onSelectBrain,
  selectedWikiId,
  onSelectWiki,
  onAddBrainItem,
  onUpdateBrainItem,
  onUpsertWikiPage,
  onMergeGraph,
  onAddLog,
  onInspect,
}: KnowledgeModuleProps) {
  const [brainSearch, setBrainSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('ALL');
  const [editingBrain, setEditingBrain] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');

  // Graph controls
  const [graphFilter, setGraphFilter] = useState<string>('ALL');
  const [graphZoom, setGraphZoom] = useState(1);
  const [activeNodeId, setActiveNodeId] = useState<string>('node-cortex');

  // Librarian Inbox state
  const [inboxTitle, setInboxTitle] = useState('');
  const [inboxProjectId, setInboxProjectId] = useState<string>('');
  const [inboxText, setInboxText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestSummary, setIngestSummary] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const filteredBrain = useMemo(() => {
    const q = brainSearch.trim().toLowerCase();
    return state.brainItems.filter((item) => {
      if (folderFilter !== 'ALL' && item.folder !== folderFilter) return false;
      if (!q) return true;
      return `${item.title} ${item.content} ${item.tags.join(' ')}`.toLowerCase().includes(q);
    });
  }, [state.brainItems, brainSearch, folderFilter]);

  const activeBrain =
    state.brainItems.find((b) => b.id === selectedBrainId) ?? filteredBrain[0] ?? state.brainItems[0];

  const activeWiki = state.wikiPages.find((w) => w.id === selectedWikiId) ?? state.wikiPages[0];

  const privacyPreview = useMemo(() => redactSecretsInText(inboxText), [inboxText]);

  const handleStartEditBrain = () => {
    if (!activeBrain) return;
    setDraftTitle(activeBrain.title);
    setDraftContent(activeBrain.content);
    setEditingBrain(true);
  };

  const handleSaveBrainEdit = () => {
    if (!activeBrain) return;
    const safe = state.settings.redactSecretsOnIngest ? redactSecretsInText(draftContent).text : draftContent;
    onUpdateBrainItem(activeBrain.id, {
      title: draftTitle.trim() || activeBrain.title,
      content: safe,
      updatedAt: new Date().toISOString(),
    });
    setEditingBrain(false);
    onAddLog({
      source: 'Librarian',
      level: 'info',
      message: `Updated Brain note "${draftTitle.trim() || activeBrain.title}"`,
    });
  };

  const handleCreateQuickNote = () => {
    const newNote: BrainItem = {
      id: `brain-${Date.now()}`,
      title: 'Untitled Vault Note',
      folder: 'Notes',
      projectId: null,
      tags: ['draft'],
      content: 'Write markdown notes, architectural decisions, or [[backlinks]] here.',
      backlinks: [],
      pinned: false,
      updatedAt: new Date().toISOString(),
      source: 'Manual Note',
    };
    onAddBrainItem(newNote);
    onSelectBrain(newNote.id);
    onInspect({ kind: 'brain', itemId: newNote.id });
    setDraftTitle(newNote.title);
    setDraftContent(newNote.content);
    setEditingBrain(true);
  };

  const handleRunLibrarian = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboxText.trim() || ingesting) return;
    setIngesting(true);
    setIngestError(null);
    setIngestSummary(null);

    const project = state.projects.find((p) => p.id === inboxProjectId) ?? null;

    onAddLog({
      source: 'Privacy',
      level: privacyPreview.redactionCount > 0 ? 'warn' : 'info',
      message:
        privacyPreview.redactionCount > 0
          ? `Redacted ${privacyPreview.redactionCount} secret pattern(s) before Librarian pipeline`
          : 'Privacy Guard verified clean input',
      detail: privacyPreview.matchedRules.join(', ') || undefined,
    });

    try {
      const res = await fetch('/api/librarian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: inboxTitle.trim() || undefined,
          rawText: inboxText,
          sourceType: 'Inbox Drop',
          projectName: project?.name ?? null,
          redactSecrets: state.settings.redactSecretsOnIngest,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Librarian ingestion failed.');

      const result = data.result;
      const brainId = `brain-${Date.now()}`;
      const validFolder = FOLDERS.includes(result.folder) ? (result.folder as BrainFolder) : 'Notes';

      const newBrain: BrainItem = {
        id: brainId,
        title: result.title,
        folder: validFolder,
        projectId: project?.id ?? null,
        tags: result.tags,
        content: `${result.summary}\n\n---\n\n${data.redactedContent}`,
        backlinks: [],
        updatedAt: new Date().toISOString(),
        source: 'Librarian Agent',
      };
      onAddBrainItem(newBrain);

      const wikiId = `wiki-${Date.now()}`;
      const newWiki: WikiPage = {
        id: wikiId,
        title: result.wikiTopicTitle,
        category: result.wikiCategory,
        projectId: project?.id ?? null,
        summary: result.summary,
        content: result.wikiMarkdown,
        citations: [brainId],
        updatedAt: new Date().toISOString(),
        compiledBy: 'Librarian',
      };
      onUpsertWikiPage(newWiki);

      // Build Graph Nodes & Edges
      const sourceNodeId = `node-${Date.now()}`;
      const baseAngle = Math.random() * Math.PI * 2;
      const sourceNode: GraphNode = {
        id: sourceNodeId,
        label: result.title.slice(0, 28),
        type: 'Document',
        projectId: project?.id ?? null,
        summary: result.summary,
        x: 380 + Math.cos(baseAngle) * 110,
        y: 210 + Math.sin(baseAngle) * 95,
      };
      const newNodes: GraphNode[] = [sourceNode];
      const newEdges: GraphEdge[] = [
        {
          id: `edge-lib-${Date.now()}`,
          source: 'node-librarian',
          target: sourceNodeId,
          relation: 'RELATES_TO',
          weight: 1,
        },
      ];

      (result.entities ?? []).forEach(
        (ent: { label: string; nodeType: string; relation: string; summary: string }, idx: number) => {
          const existing = state.graphNodes.find(
            (n) => n.label.toLowerCase() === ent.label.toLowerCase()
          );
          const targetId = existing ? existing.id : `node-ent-${Date.now()}-${idx}`;
          if (!existing) {
            const angle = baseAngle + (idx + 1) * 1.1;
            newNodes.push({
              id: targetId,
              label: ent.label,
              type: (ent.nodeType as GraphNodeType) || 'Concept',
              projectId: project?.id ?? null,
              summary: ent.summary || ent.label,
              x: Math.max(80, Math.min(680, sourceNode.x + Math.cos(angle) * 135)),
              y: Math.max(60, Math.min(390, sourceNode.y + Math.sin(angle) * 105)),
            });
          }
          newEdges.push({
            id: `edge-ent-${Date.now()}-${idx}`,
            source: sourceNodeId,
            target: targetId,
            relation: (ent.relation as GraphRelation) || 'REFERENCES',
            weight: 1,
          });
        }
      );

      onMergeGraph(newNodes, newEdges);

      setIngestSummary(
        `Filed "${result.title}" into Brain (${validFolder}), compiled Wiki entry "${result.wikiTopicTitle}", added ${newNodes.length} graph node(s), and redacted ${data.redactionCount} secret(s).`
      );
      setInboxTitle('');
      setInboxText('');

      onAddLog({
        source: 'Librarian',
        level: 'success',
        message: `Ingested "${result.title}" -> Brain + Wiki + ${newNodes.length} Graph nodes (${data.latencyMs}ms)`,
        detail: `${data.chunksCount} chunk(s) · ${data.redactionCount} redaction(s)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Librarian failed.';
      setIngestError(msg);
      onAddLog({ source: 'Librarian', level: 'error', message: msg });
    } finally {
      setIngesting(false);
    }
  };

  const visibleNodes = useMemo(() => {
    if (graphFilter === 'ALL') return state.graphNodes;
    return state.graphNodes.filter((n) => n.type === graphFilter);
  }, [state.graphNodes, graphFilter]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-module Tabs */}
      <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
          {[
            { id: 'brain' as const, label: 'Brain Vault', icon: <Brain className="w-3.5 h-3.5" /> },
            { id: 'wiki' as const, label: 'LLM Wiki', icon: <BookOpen className="w-3.5 h-3.5" /> },
            { id: 'graph' as const, label: 'Knowledge Graph', icon: <GitBranch className="w-3.5 h-3.5" /> },
            { id: 'inbox' as const, label: 'Inbox (Librarian)', icon: <Inbox className="w-3.5 h-3.5" /> },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-500">
          {state.brainItems.length} notes · {state.wikiPages.length} wiki pages · {state.graphNodes.length} nodes
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'brain' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 h-full min-h-[540px]">
            {/* Left List */}
            <div className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900/40">
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      value={brainSearch}
                      onChange={(e) => setBrainSearch(e.target.value)}
                      placeholder="Filter vault..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateQuickNote}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 whitespace-nowrap"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    Note
                  </button>
                </div>

                <select
                  aria-label="Filter folder"
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                >
                  <option value="ALL">All Vault Folders ({state.brainItems.length})</option>
                  {FOLDERS.map((f) => (
                    <option key={f} value={f}>
                      {f} ({state.brainItems.filter((b) => b.folder === f).length})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredBrain.map((item) => {
                  const selected = activeBrain?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectBrain(item.id);
                        onInspect({ kind: 'brain', itemId: item.id });
                        setEditingBrain(false);
                      }}
                      className={`w-full p-3.5 text-left transition-colors ${
                        selected
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/40'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {item.title}
                        </span>
                        {item.pinned && <Pin className="w-3 h-3 text-indigo-500 shrink-0" />}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 truncate">
                        {item.folder} · {item.tags.join(' · ')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Markdown Editor / Reader */}
            <div className="lg:col-span-8 p-6 overflow-y-auto">
              {activeBrain ? (
                <div className="max-w-3xl space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-xs font-mono text-slate-500">
                        {activeBrain.folder} · {activeBrain.source ?? 'Vault'} · {activeBrain.tags.join(' · ')}
                      </div>
                      {editingBrain ? (
                        <input
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          className="mt-2 w-full px-3 py-1.5 text-lg font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      ) : (
                        <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
                          {activeBrain.title}
                        </h2>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onUpdateBrainItem(activeBrain.id, { pinned: !activeBrain.pinned })}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {activeBrain.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      {editingBrain ? (
                        <button
                          type="button"
                          onClick={handleSaveBrainEdit}
                          className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
                        >
                          Save Note
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartEditBrain}
                          className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                        >
                          Edit Markdown
                        </button>
                      )}
                    </div>
                  </div>

                  {editingBrain ? (
                    <textarea
                      rows={14}
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      className="w-full p-4 text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 leading-relaxed"
                    />
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Markdown>{activeBrain.content}</Markdown>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-20 text-center text-sm text-slate-500">Select or create a Brain note.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'wiki' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 h-full min-h-[540px]">
            <div className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/70 bg-white dark:bg-slate-900/40">
              {state.wikiPages.map((page) => {
                const selected = activeWiki?.id === page.id;
                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => {
                      onSelectWiki(page.id);
                      onInspect({ kind: 'wiki', pageId: page.id });
                    }}
                    className={`w-full p-4 text-left transition-colors ${
                      selected
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400">{page.category}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{page.title}</div>
                    <div className="mt-1 text-xs text-slate-500 line-clamp-2">{page.summary}</div>
                    <div className="mt-2 text-[11px] font-mono tabular-nums text-slate-400">
                      {page.citations.length} source citation(s) · Compiled by {page.compiledBy}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="lg:col-span-8 p-6 overflow-y-auto">
              {activeWiki ? (
                <article className="max-w-3xl space-y-5">
                  <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-mono text-slate-500">
                      LLM Wiki · {activeWiki.category} · Compiled by {activeWiki.compiledBy}
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                      {activeWiki.title}
                    </h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{activeWiki.summary}</p>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <Markdown>{activeWiki.content}</Markdown>
                  </div>
                </article>
              ) : (
                <div className="py-20 text-center text-sm text-slate-500">Select a Wiki topic page.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="p-6 space-y-4 h-full flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {['ALL', 'Project', 'Document', 'Agent', 'Concept', 'Model'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGraphFilter(t)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                      graphFilter === t
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setGraphZoom((z) => Math.max(0.7, Math.round((z - 0.15) * 100) / 100))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Zoom out graph"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono tabular-nums px-2">{Math.round(graphZoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setGraphZoom((z) => Math.min(1.6, Math.round((z + 0.15) * 100) / 100))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Zoom in graph"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-[440px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden relative">
              <svg
                viewBox="0 0 760 450"
                className="w-full h-full select-none"
                style={{ transform: `scale(${graphZoom})`, transformOrigin: 'center center' }}
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="20"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
                  </marker>
                </defs>

                {state.graphEdges
                  .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
                  .map((edge) => {
                    const src = state.graphNodes.find((n) => n.id === edge.source);
                    const tgt = state.graphNodes.find((n) => n.id === edge.target);
                    if (!src || !tgt) return null;
                    const highlighted = activeNodeId === src.id || activeNodeId === tgt.id;
                    const midX = (src.x + tgt.x) / 2;
                    const midY = (src.y + tgt.y) / 2;
                    return (
                      <g key={edge.id}>
                        <line
                          x1={src.x}
                          y1={src.y}
                          x2={tgt.x}
                          y2={tgt.y}
                          stroke={highlighted ? '#6366f1' : '#475569'}
                          strokeOpacity={highlighted ? 0.9 : 0.35}
                          strokeWidth={highlighted ? 2 : 1.2}
                          markerEnd="url(#arrow)"
                        />
                        <text
                          x={midX}
                          y={midY - 4}
                          textAnchor="middle"
                          className="fill-slate-400 text-[9px] font-mono"
                        >
                          {edge.relation}
                        </text>
                      </g>
                    );
                  })}

                {visibleNodes.map((node) => {
                  const isActive = activeNodeId === node.id;
                  const color = NODE_COLORS[node.type] ?? '#6366f1';
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer"
                      onClick={() => {
                        setActiveNodeId(node.id);
                        onInspect({ kind: 'node', nodeId: node.id });
                      }}
                    >
                      <circle
                        r={isActive ? 18 : 14}
                        fill={color}
                        fillOpacity={isActive ? 0.95 : 0.8}
                        stroke={isActive ? '#ffffff' : color}
                        strokeWidth={isActive ? 2.5 : 1}
                      />
                      <text
                        y={28}
                        textAnchor="middle"
                        className="fill-slate-800 dark:fill-slate-200 text-[11px] font-medium"
                      >
                        {node.label}
                      </text>
                      <text y={40} textAnchor="middle" className="fill-slate-400 text-[9px] font-mono">
                        {node.type}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {activeTab === 'inbox' && (
          <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Librarian Ingestion Pipeline
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Paste meeting notes, architecture RFCs, code snippets, or research captures. The Privacy Guard redacts secrets first, then the Librarian classifies, compiles a Wiki entry, and updates the Knowledge Graph.
              </p>
            </div>

            <form
              onSubmit={handleRunLibrarian}
              className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Title Hint (optional)
                  </label>
                  <input
                    value={inboxTitle}
                    onChange={(e) => setInboxTitle(e.target.value)}
                    placeholder="e.g., sqlite-vec Migration Plan"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Assign Project Space
                  </label>
                  <select
                    value={inboxProjectId}
                    onChange={(e) => setInboxProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="">Global Knowledge (Brain + Wiki)</option>
                    {state.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Raw Capture Content
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setInboxTitle('Hybrid Vector + FTS5 Retrieval Spec');
                      setInboxText(
                        'Architecture decision: replace the 3,000-item in-memory vector cap with paginated sqlite-vec queries paired with FTS5 BM25 ranking. Never send raw credentials like sk-proj-example1234567890abcdef to external endpoints.'
                      );
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Load Sample With Secret Redaction Test
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={inboxText}
                  onChange={(e) => setInboxText(e.target.value)}
                  placeholder="Paste any markdown, PDF excerpt, terminal output, or research article..."
                  className="w-full p-3 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    {privacyPreview.redactionCount > 0
                      ? `Privacy Guard detected ${privacyPreview.redactionCount} secret pattern(s) (${privacyPreview.matchedRules.join(', ')}) — will redact before LLM call.`
                      : 'Privacy Guard active: API keys, AWS IDs, and tokens are redacted automatically.'}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={ingesting || !inboxText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {ingesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{ingesting ? 'Running Librarian...' : 'Run Librarian Pipeline'}</span>
                </button>
              </div>
            </form>

            {ingestError && (
              <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                {ingestError}
              </div>
            )}

            {ingestSummary && (
              <div className="p-4 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-sm text-emerald-900 dark:text-emerald-200">
                {ingestSummary}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
