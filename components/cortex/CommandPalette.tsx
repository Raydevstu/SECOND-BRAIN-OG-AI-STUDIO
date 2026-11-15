'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  FolderKanban,
  Home,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Puzzle,
  Search,
  Settings,
  Sun,
  Terminal,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { NAV_ITEMS } from '@/mock/nav';
import type {
  CortexState,
  InspectorTarget,
  KnowledgeTab,
  ModuleId,
  NavIconName,
} from '@/lib/types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  state: CortexState;
  onNavigate: (
    module: ModuleId,
    opts?: {
      knowledgeTab?: KnowledgeTab;
      inspector?: InspectorTarget;
      chatId?: string;
      projectId?: string | null;
    }
  ) => void;
  onCreateChat: () => void;
  onToggleTheme: () => void;
  onToggleContext: () => void;
  onToggleInspector: () => void;
  onToggleRunLog: () => void;
}

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action: () => void;
}

const GROUP_ORDER = [
  'Actions',
  'Workspaces',
  'Projects',
  'Agents',
  'Chats',
  'Brain Vault',
  'LLM Wiki',
  'Workflows',
] as const;

const WORKSPACE_SUBTITLES: Record<ModuleId, string> = {
  home: 'Mission control, recent chats, tasks, knowledge growth',
  chat: 'Multi-provider AI Router conversations & threads',
  agents: 'Agent fleet definitions, prompts, budgets, permissions',
  knowledge: 'Second Brain vault, compiled LLM Wiki, knowledge graph & inbox',
  projects: 'Isolated project spaces, files, and deliverables',
  workflows: 'Automated triggers, pipelines, and scheduled runs',
  plugins: 'Connected integrations, scopes, and MCP servers',
  settings: 'Task routing, privacy guard, scan roots & theme',
};

const NAV_ICONS: Record<NavIconName, React.ReactNode> = {
  home: <Home className="w-4 h-4" />,
  chat: <MessageSquare className="w-4 h-4" />,
  agents: <Bot className="w-4 h-4" />,
  knowledge: <Brain className="w-4 h-4" />,
  projects: <FolderKanban className="w-4 h-4" />,
  workflows: <Zap className="w-4 h-4" />,
  plugins: <Puzzle className="w-4 h-4" />,
  settings: <Settings className="w-4 h-4" />,
};

function hasWordStartMatch(haystack: string, q: string): boolean {
  let idx = haystack.indexOf(q);
  while (idx !== -1) {
    if (idx === 0 || !/[a-z0-9]/.test(haystack[idx - 1])) return true;
    idx = haystack.indexOf(q, idx + 1);
  }
  return false;
}

function getMatchRank(item: PaletteItem, q: string): number | null {
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle.toLowerCase();
  const group = item.group.toLowerCase();

  if (title.startsWith(q)) return 0;
  if (hasWordStartMatch(title, q) || hasWordStartMatch(subtitle, q)) return 1;
  if (`${title} ${subtitle} ${group}`.includes(q)) return 2;
  return null;
}

export function CommandPalette({
  open,
  onClose,
  state,
  onNavigate,
  onCreateChat,
  onToggleTheme,
  onToggleContext,
  onToggleInspector,
  onToggleRunLog,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const scrollOnNextActiveRef = useRef(false);

  const handleClose = useCallback(() => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && prev.isConnected) {
        prev.focus();
      }
      const raf = requestAnimationFrame(() => {
        setQuery('');
        setActiveIndex(0);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: 'act-new-chat',
        group: 'Actions',
        title: 'New Chat Session',
        subtitle: 'Open a fresh AI Router conversation',
        icon: <Plus className="w-4 h-4 text-indigo-500" />,
        action: () => {
          onCreateChat();
          handleClose();
        },
      },
      {
        id: 'act-librarian',
        group: 'Actions',
        title: 'Open Librarian Inbox',
        subtitle: 'Drop or paste content for privacy-safe ingestion',
        icon: <Brain className="w-4 h-4 text-emerald-500" />,
        action: () => {
          onNavigate('knowledge', { knowledgeTab: 'inbox' });
          handleClose();
        },
      },
      {
        id: 'act-context',
        group: 'Actions',
        title: 'Toggle Context Panel',
        subtitle: 'Show or hide left workspace context panel (Ctrl+B)',
        icon: <PanelLeft className="w-4 h-4 text-slate-500" />,
        action: () => {
          onToggleContext();
          handleClose();
        },
      },
      {
        id: 'act-inspector',
        group: 'Actions',
        title: 'Toggle Inspector Panel',
        subtitle: 'Show or hide right contextual inspector',
        icon: <PanelRight className="w-4 h-4 text-slate-500" />,
        action: () => {
          onToggleInspector();
          handleClose();
        },
      },
      {
        id: 'act-runlog',
        group: 'Actions',
        title: 'Toggle Run Log Drawer',
        subtitle: 'Inspect router, RAG, and workflow traces',
        icon: <Terminal className="w-4 h-4 text-slate-500" />,
        action: () => {
          onToggleRunLog();
          handleClose();
        },
      },
      {
        id: 'act-theme',
        group: 'Actions',
        title: state.settings.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        subtitle: 'Toggle workbench color theme',
        icon:
          state.settings.theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          ),
        action: () => {
          onToggleTheme();
          handleClose();
        },
      },
    ];

    for (const nav of NAV_ITEMS) {
      items.push({
        id: `nav-${nav.id}`,
        group: 'Workspaces',
        title: nav.label,
        subtitle: WORKSPACE_SUBTITLES[nav.id],
        icon: NAV_ICONS[nav.icon],
        action: () => {
          onNavigate(nav.id);
          handleClose();
        },
      });
    }

    for (const p of state.projects) {
      items.push({
        id: `proj-${p.id}`,
        group: 'Projects',
        title: p.name,
        subtitle: `${p.filesCount} files · ${p.description}`,
        icon: <FolderKanban className="w-4 h-4 text-amber-500" />,
        action: () => {
          onNavigate('projects', { projectId: p.id, inspector: { kind: 'project', projectId: p.id } });
          handleClose();
        },
      });
    }

    for (const a of state.agents) {
      items.push({
        id: `agent-${a.id}`,
        group: 'Agents',
        title: a.name,
        subtitle: `${a.roleTag} · ${a.model}`,
        icon: <Bot className="w-4 h-4 text-indigo-500" />,
        action: () => {
          onNavigate('agents', { inspector: { kind: 'agent', agentId: a.id } });
          handleClose();
        },
      });
    }

    for (const c of state.chats) {
      items.push({
        id: `chat-${c.id}`,
        group: 'Chats',
        title: c.title,
        subtitle: `${c.mode} · ${c.messages.length} messages`,
        icon: <MessageSquare className="w-4 h-4 text-sky-500" />,
        action: () => {
          onNavigate('chat', { chatId: c.id, inspector: { kind: 'chat', chatId: c.id } });
          handleClose();
        },
      });
    }

    for (const b of state.brainItems) {
      items.push({
        id: `brain-${b.id}`,
        group: 'Brain Vault',
        title: b.title,
        subtitle: `${b.folder} · ${b.tags.join(', ')}`,
        icon: <Brain className="w-4 h-4 text-emerald-500" />,
        action: () => {
          onNavigate('knowledge', { knowledgeTab: 'brain', inspector: { kind: 'brain', itemId: b.id } });
          handleClose();
        },
      });
    }

    for (const w of state.wikiPages) {
      items.push({
        id: `wiki-${w.id}`,
        group: 'LLM Wiki',
        title: w.title,
        subtitle: `${w.category} · ${w.citations.length} citations`,
        icon: <Brain className="w-4 h-4 text-violet-500" />,
        action: () => {
          onNavigate('knowledge', { knowledgeTab: 'wiki', inspector: { kind: 'wiki', pageId: w.id } });
          handleClose();
        },
      });
    }

    for (const wf of state.workflows) {
      items.push({
        id: `wf-${wf.id}`,
        group: 'Workflows',
        title: wf.name,
        subtitle: `${wf.triggerType} · ${wf.steps.length} steps`,
        icon: <Workflow className="w-4 h-4 text-orange-500" />,
        action: () => {
          onNavigate('workflows', { inspector: { kind: 'workflow', workflowId: wf.id } });
          handleClose();
        },
      });
    }

    return items;
  }, [
    state,
    onNavigate,
    onCreateChat,
    onToggleContext,
    onToggleInspector,
    onToggleRunLog,
    onToggleTheme,
    handleClose,
  ]);

  const { groups, flatItems } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const bucketMap = new Map<string, Array<{ item: PaletteItem; rank: number }>>();

    if (!q) {
      for (const item of allItems.slice(0, 14)) {
        const list = bucketMap.get(item.group) ?? [];
        list.push({ item, rank: 0 });
        bucketMap.set(item.group, list);
      }
    } else {
      const scored = allItems
        .map((item, idx) => ({ item, rank: getMatchRank(item, q), idx }))
        .filter((entry): entry is { item: PaletteItem; rank: number; idx: number } => entry.rank !== null)
        .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
        .slice(0, 16);

      for (const entry of scored) {
        const list = bucketMap.get(entry.item.group) ?? [];
        list.push({ item: entry.item, rank: entry.rank });
        bucketMap.set(entry.item.group, list);
      }
    }

    const orderedGroupNames = [...bucketMap.keys()].sort((a, b) => {
      if (q) {
        const bestA = Math.min(...(bucketMap.get(a) ?? []).map((x) => x.rank));
        const bestB = Math.min(...(bucketMap.get(b) ?? []).map((x) => x.rank));
        if (bestA !== bestB) return bestA - bestB;
      }
      const orderA = GROUP_ORDER.indexOf(a as (typeof GROUP_ORDER)[number]);
      const orderB = GROUP_ORDER.indexOf(b as (typeof GROUP_ORDER)[number]);
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    });

    const grouped: Array<{
      label: string;
      items: Array<{ item: PaletteItem; flatIndex: number }>;
    }> = [];
    const flattened: PaletteItem[] = [];

    for (const label of orderedGroupNames) {
      const entries = bucketMap.get(label) ?? [];
      grouped.push({
        label,
        items: entries.map(({ item }) => {
          const flatIndex = flattened.length;
          flattened.push(item);
          return { item, flatIndex };
        }),
      });
    }

    return { groups: grouped, flatItems: flattened };
  }, [allItems, query]);

  useEffect(() => {
    if (!open || flatItems.length === 0 || !scrollOnNextActiveRef.current) return;
    scrollOnNextActiveRef.current = false;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, flatItems.length]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const container = dialogRef.current;
        if (!container) return;
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        scrollOnNextActiveRef.current = true;
        setActiveIndex((prev) => (flatItems.length ? (prev + 1) % flatItems.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scrollOnNextActiveRef.current = true;
        setActiveIndex((prev) => (flatItems.length ? (prev - 1 + flatItems.length) % flatItems.length : 0));
      } else if (e.key === 'Enter' && !e.isComposing && flatItems[activeIndex]) {
        e.preventDefault();
        flatItems[activeIndex].action();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, flatItems, activeIndex, handleClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-slate-950/60 backdrop-blur-xs"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Bar"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search notes, chats, projects, agents, wiki pages, or run an action..."
            className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
            aria-label="Close command bar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {flatItems.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No matching records across Brain, Wiki, Chats, Projects, or Agents.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="divide-y divide-slate-100 dark:divide-slate-800/70">
                <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50/70 dark:bg-slate-950/40">
                  {group.label}
                </div>
                {group.items.map(({ item, flatIndex }) => {
                  const selected = flatIndex === activeIndex;
                  return (
                    <button
                      key={item.id}
                      ref={(el) => {
                        itemRefs.current[flatIndex] = el;
                      }}
                      type="button"
                      tabIndex={-1}
                      onClick={item.action}
                      onMouseEnter={() => {
                        scrollOnNextActiveRef.current = false;
                        setActiveIndex(flatIndex);
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                        selected
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 text-slate-900 dark:text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="shrink-0 text-slate-500 dark:text-slate-400">{item.icon}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{item.title}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {item.subtitle}
                          </div>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 shrink-0">{item.group}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-[11px] text-slate-500">
          <span>Navigate with Up/Down · Enter to open · Esc to dismiss</span>
          <span className="font-mono tabular-nums">{flatItems.length} results</span>
        </div>
      </div>
    </div>
  );
}

