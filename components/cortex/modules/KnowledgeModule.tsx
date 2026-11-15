'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  InspectorTarget,
  KnowledgeTab,
  RunLogEntry,
  WikiPage,
} from '@/lib/types';
import { mapLibrarianResultToKnowledge } from './knowledge/ingestMapping';

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

const NODE_TYPES = Object.keys(NODE_COLORS) as GraphNodeType[];
const FOLDERS: BrainFolder[] = ['Memories', 'Ideas', 'Notes', 'Goals', 'Tasks', 'People', 'Bookmarks', 'Journal'];
const GRAPH_BASE_WIDTH = 760;
const GRAPH_BASE_HEIGHT = 450;

interface RecentIngestEntry {
  id: string;
  title: string;
  time: string;
  status: 'filed' | 'failed';
  brainId?: string;
}

function matchesBrainFilter(item: BrainItem, search: string, folder: string): boolean {
  if (folder !== 'ALL' && item.folder !== folder) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return `${item.title} ${item.content} ${item.tags.join(' ')}`.toLowerCase().includes(q);
}

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

  // Wiki controls
  const [wikiSearch, setWikiSearch] = useState('');

  // Graph controls
  const [graphFilter, setGraphFilter] = useState<string>('ALL');
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphPan, setGraphPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string>('node-cortex');
  const svgRef = useRef<SVGSVGElement>(null);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);

  // Librarian Inbox state
  const [inboxTitle, setInboxTitle] = useState('');
  const [inboxProjectId, setInboxProjectId] = useState<string>('');
  const [inboxText, setInboxText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestSummary, setIngestSummary] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [recentIngests, setRecentIngests] = useState<RecentIngestEntry[]>([]);

  const filteredBrain = useMemo(
    () => state.brainItems.filter((item) => matchesBrainFilter(item, brainSearch, folderFilter)),
    [state.brainItems, brainSearch, folderFilter]
  );

  const activeBrain =
    filteredBrain.find((b) => b.id === selectedBrainId) ?? filteredBrain[0] ?? null;

  const prevActiveBrainIdRef = useRef<string | null>(activeBrain?.id ?? null);
  useEffect(() => {
    const currentId = activeBrain?.id ?? null;
    if (prevActiveBrainIdRef.current !== currentId) {
      prevActiveBrainIdRef.current = currentId;
      if (editingBrain) {
        const raf = requestAnimationFrame(() => setEditingBrain(false));
        return () => cancelAnimationFrame(raf);
      }
    }
  }, [activeBrain?.id, editingBrain]);

  const brainById = useMemo(
    () => new Map(state.brainItems.map((item) => [item.id, item])),
    [state.brainItems]
  );

  const filteredWiki = useMemo(() => {
    const q = wikiSearch.trim().toLowerCase();
    if (!q) return state.wikiPages;
    return state.wikiPages.filter((page) =>
      `${page.title} ${page.category} ${page.summary}`.toLowerCase().includes(q)
    );
  }, [state.wikiPages, wikiSearch]);

  const activeWiki =
    filteredWiki.find((w) => w.id === selectedWikiId) ?? filteredWiki[0] ?? null;

  const nodeById = useMemo(
    () => new Map(state.graphNodes.map((n) => [n.id, n])),
    [state.graphNodes]
  );

  const effectiveActiveNodeId = activeNodeId && nodeById.has(activeNodeId) ? activeNodeId : null;

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

  const confirmDiscardBrainEdits = (): boolean => {
    if (!editingBrain) return true;
    return window.confirm('Discard unsaved edits to the current note?');
  };

  const handleTabClick = (nextTab: KnowledgeTab) => {
    if (nextTab === activeTab) return;
    if (activeTab === 'brain' && editingBrain) {
      if (!confirmDiscardBrainEdits()) {
        return;
      }
      setEditingBrain(false);
    }
    onTabChange(nextTab);
  };

  const handleBrainSearchChange = (nextSearch: string) => {
    if (editingBrain && activeBrain && !matchesBrainFilter(activeBrain, nextSearch, folderFilter)) {
      if (!confirmDiscardBrainEdits()) {
        return;
      }
      setEditingBrain(false);
    }
    setBrainSearch(nextSearch);
  };

  const handleFolderFilterChange = (nextFolder: string) => {
    if (editingBrain && activeBrain && !matchesBrainFilter(activeBrain, brainSearch, nextFolder)) {
      if (!confirmDiscardBrainEdits()) {
        return;
      }
      setEditingBrain(false);
    }
    setFolderFilter(nextFolder);
  };

  const handleSelectBrainNote = (
    itemId: string,
    opts?: { ensureVisible?: boolean; switchToBrainTab?: boolean }
  ) => {
    if (editingBrain && activeBrain?.id !== itemId) {
      if (!confirmDiscardBrainEdits()) {
        return;
      }
    }
    if (opts?.ensureVisible && !filteredBrain.some((b) => b.id === itemId)) {
      setBrainSearch('');
      setFolderFilter('ALL');
    }
    if (opts?.switchToBrainTab && activeTab !== 'brain') {
      onTabChange('brain');
    }
    onSelectBrain(itemId);
    onInspect({ kind: 'brain', itemId });
    setEditingBrain(false);
  };

  const handleCreateQuickNote = () => {
    if (editingBrain && !window.confirm('Discard unsaved edits to the current note?')) {
      return;
    }
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

      const nowMs = Date.now();
      const mapped = mapLibrarianResultToKnowledge({
        result: data.result,
        redactedContent: data.redactedContent,
        projectId: project?.id ?? null,
        existingGraphNodes: state.graphNodes,
        timestampMs: nowMs,
        updatedAtIso: new Date(nowMs).toISOString(),
      });

      onAddBrainItem(mapped.brainItem);
      onUpsertWikiPage(mapped.wikiPage);
      onMergeGraph(mapped.nodes, mapped.edges);

      setRecentIngests((prev) => [
        {
          id: `ingest-${nowMs}`,
          title: mapped.brainItem.title,
          time: new Date(nowMs).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          status: 'filed',
          brainId: mapped.brainItem.id,
        },
        ...prev,
      ]);

      setIngestSummary(
        `Filed "${mapped.brainItem.title}" into Brain (${mapped.validFolder}), compiled Wiki entry "${mapped.wikiPage.title}", added ${mapped.nodes.length} graph node(s), and redacted ${data.redactionCount} secret(s).`
      );
      setInboxTitle('');
      setInboxText('');

      onAddLog({
        source: 'Librarian',
        level: 'success',
        message: `Ingested "${mapped.brainItem.title}" -> Brain + Wiki + ${mapped.nodes.length} Graph nodes (${data.latencyMs}ms)`,
        detail: `${data.chunksCount} chunk(s) · ${data.redactionCount} redaction(s)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Librarian failed.';
      const nowMs = Date.now();
      setIngestError(msg);
      setRecentIngests((prev) => [
        {
          id: `ingest-${nowMs}`,
          title: inboxTitle.trim() || 'Untitled Capture',
          time: new Date(nowMs).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          status: 'failed',
        },
        ...prev,
      ]);
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
        <div
          role="tablist"
          aria-label="Knowledge sections"
          className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80"
        >
          {[
            { id: 'brain' as const, label: 'Brain Vault', icon: <Brain className="w-3.5 h-3.5" /> },
            { id: 'wiki' as const, label: 'LLM Wiki', icon: <BookOpen className="w-3.5 h-3.5" /> },
            { id: 'graph' as const, label: 'Knowledge Graph', icon: <GitBranch className="w-3.5 h-3.5" /> },
            { id: 'inbox' as const, label: 'Inbox (Librarian)', icon: <Inbox className="w-3.5 h-3.5" /> },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => handleTabClick(t.id)}
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
            <div className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900/40 min-h-0">
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      value={brainSearch}
                      onChange={(e) => handleBrainSearchChange(e.target.value)}
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
                  onChange={(e) => handleFolderFilterChange(e.target.value)}
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
                {filteredBrain.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No notes match the current filter.
                  </div>
                ) : (
                  filteredBrain.map((item) => {
                    const selected = activeBrain?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectBrainNote(item.id)}
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
                  })
                )}
              </div>
            </div>

            {/* Right Markdown Editor / Reader */}
            <div className="lg:col-span-8 p-6 overflow-y-auto min-h-0">
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

                  {activeBrain.backlinks.length > 0 && (
                    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Backlinks
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {activeBrain.backlinks.map((ref) => {
                          const normalized = ref.trim().toLowerCase();
                          const targetNote =
                            brainById.get(ref) ??
                            state.brainItems.find((b) => b.title.toLowerCase() === normalized);
                          if (targetNote) {
                            return (
                              <button
                                key={ref}
                                type="button"
                                onClick={() => handleSelectBrainNote(targetNote.id, { ensureVisible: true })}
                                className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                              >
                                {targetNote.title}
                              </button>
                            );
                          }
                          return (
                            <span
                              key={ref}
                              className="px-2.5 py-1 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 text-slate-400"
                            >
                              {ref}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-20 text-center text-sm text-slate-500">
                  {state.brainItems.length > 0 && filteredBrain.length === 0
                    ? 'No notes match the current filter.'
                    : 'Select or create a Brain note.'}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'wiki' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 h-full min-h-[540px]">
            <div className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900/40 min-h-0">
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    value={wikiSearch}
                    onChange={(e) => setWikiSearch(e.target.value)}
                    placeholder="Filter wiki pages..."
                    aria-label="Filter wiki pages"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredWiki.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No wiki pages match the current search.
                  </div>
                ) : (
                  filteredWiki.map((page) => {
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
                  })
                )}
              </div>
            </div>

            <div className="lg:col-span-8 p-6 overflow-y-auto min-h-0">
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

                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Source Citations
                    </div>
                    {activeWiki.citations.length === 0 ? (
                      <div className="text-xs text-slate-500">No source citations linked.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {activeWiki.citations.map((citationId) => {
                          const sourceNote = brainById.get(citationId);
                          if (!sourceNote) {
                            return (
                              <li
                                key={citationId}
                                className="text-xs font-mono text-slate-400"
                              >
                                missing source ({citationId})
                              </li>
                            );
                          }
                          return (
                            <li key={citationId}>
                              <button
                                type="button"
                                onClick={() =>
                                  handleSelectBrainNote(sourceNote.id, {
                                    ensureVisible: true,
                                    switchToBrainTab: true,
                                  })
                                }
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline text-left"
                              >
                                {sourceNote.title}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </article>
              ) : (
                <div className="py-20 text-center text-sm text-slate-500">
                  {state.wikiPages.length > 0 && filteredWiki.length === 0
                    ? 'No wiki pages match the current search.'
                    : 'Select a Wiki topic page.'}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="p-6 space-y-4 h-full flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', ...NODE_TYPES] as const).map((t) => (
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
              {(() => {
                const vbWidth = GRAPH_BASE_WIDTH / graphZoom;
                const vbHeight = GRAPH_BASE_HEIGHT / graphZoom;
                const vbX = (GRAPH_BASE_WIDTH - vbWidth) / 2 + graphPan.x;
                const vbY = (GRAPH_BASE_HEIGHT - vbHeight) / 2 + graphPan.y;
                return (
                  <svg
                    ref={svgRef}
                    viewBox={`${vbX} ${vbY} ${vbWidth} ${vbHeight}`}
                    className={`w-full h-full select-none ${
                      isPanning ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      panStartRef.current = {
                        clientX: e.clientX,
                        clientY: e.clientY,
                        panX: graphPan.x,
                        panY: graphPan.y,
                      };
                      setIsPanning(true);
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      const start = panStartRef.current;
                      if (!start || !svgRef.current) return;
                      const rect = svgRef.current.getBoundingClientRect();
                      if (rect.width <= 0 || rect.height <= 0) return;
                      const scale = Math.max(vbWidth / rect.width, vbHeight / rect.height);
                      const dx = (e.clientX - start.clientX) * scale;
                      const dy = (e.clientY - start.clientY) * scale;
                      setGraphPan({
                        x: Math.max(-500, Math.min(500, start.panX - dx)),
                        y: Math.max(-350, Math.min(350, start.panY - dy)),
                      });
                    }}
                    onPointerUp={(e) => {
                      if (panStartRef.current) {
                        panStartRef.current = null;
                        setIsPanning(false);
                        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      }
                    }}
                    onPointerCancel={(e) => {
                      if (panStartRef.current) {
                        panStartRef.current = null;
                        setIsPanning(false);
                        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      }
                    }}
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
                        const src = nodeById.get(edge.source);
                        const tgt = nodeById.get(edge.target);
                        if (!src || !tgt) return null;
                        const highlighted =
                          effectiveActiveNodeId !== null &&
                          (effectiveActiveNodeId === src.id || effectiveActiveNodeId === tgt.id);
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
                            {highlighted && (
                              <text
                                x={midX}
                                y={midY - 4}
                                textAnchor="middle"
                                className="fill-slate-400 text-[9px] font-mono"
                              >
                                {edge.relation}
                              </text>
                            )}
                          </g>
                        );
                      })}

                    {visibleNodes.map((node) => {
                      const isActive = effectiveActiveNodeId === node.id;
                      const color = NODE_COLORS[node.type] ?? '#6366f1';
                      const selectNode = () => {
                        setActiveNodeId(node.id);
                        onInspect({ kind: 'node', nodeId: node.id });
                      };
                      return (
                        <g
                          key={node.id}
                          transform={`translate(${node.x}, ${node.y})`}
                          className="group cursor-pointer focus:outline-none"
                          tabIndex={0}
                          role="button"
                          aria-label={`${node.label}, ${node.type}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={selectNode}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectNode();
                            }
                          }}
                        >
                          <circle
                            r={isActive ? 23 : 19}
                            fill="none"
                            stroke="#6366f1"
                            strokeWidth={2.5}
                            className="opacity-0 group-focus-visible:opacity-100 pointer-events-none transition-opacity"
                          />
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
                );
              })()}
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
                        'Architecture decision: replace the 3,000-item in-memory vector cap with paginated sqlite-vec queries paired with FTS5 BM25 ranking. Never send raw credentials like sk-test-FAKE-000000000000 to external endpoints.'
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
                      ? `Privacy Guard (client-side preview only; the server redacts): detected ${privacyPreview.redactionCount} secret pattern(s) (${privacyPreview.matchedRules.join(', ')}).`
                      : 'Privacy Guard (client-side preview only; the server redacts): API keys, AWS IDs, and tokens are redacted automatically.'}
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

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recent ingests
              </div>
              {recentIngests.length === 0 ? (
                <div className="text-xs text-slate-500">No ingests run in this session yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {recentIngests.map((row) => (
                    <div
                      key={row.id}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {row.title}
                        </span>
                        <span className="font-mono text-slate-400 shrink-0">{row.time}</span>
                        <span
                          className={`font-mono px-1.5 py-0.5 rounded shrink-0 ${
                            row.status === 'filed'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                          }`}
                        >
                          {row.status}
                        </span>
                      </div>
                      {row.status === 'filed' && row.brainId && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSelectBrainNote(row.brainId!, {
                              ensureVisible: true,
                              switchToBrainTab: true,
                            })
                          }
                          className="text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                        >
                          Open Brain note
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
