'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  FolderKanban,
  Home,
  MessageSquare,
  Moon,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sun,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import type { CortexState, InspectorTarget, KnowledgeTab, ModuleId } from '@/lib/types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  state: CortexState;
  onNavigate: (module: ModuleId, opts?: { knowledgeTab?: KnowledgeTab; inspector?: InspectorTarget; chatId?: string; projectId?: string | null }) => void;
  onCreateChat: () => void;
  onToggleTheme: () => void;
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

export function CommandPalette({
  open,
  onClose,
  state,
  onNavigate,
  onCreateChat,
  onToggleTheme,
  onToggleInspector,
  onToggleRunLog,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
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
          onClose();
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
          onClose();
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
          onClose();
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
          onClose();
        },
      },
      {
        id: 'act-theme',
        group: 'Actions',
        title: state.settings.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        subtitle: 'Toggle workbench color theme',
        icon: state.settings.theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-600" />,
        action: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: 'nav-home',
        group: 'Workspaces',
        title: 'Home · Mission Control',
        subtitle: 'Recent chats, tasks, knowledge growth',
        icon: <Home className="w-4 h-4" />,
        action: () => {
          onNavigate('home');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        group: 'Workspaces',
        title: 'Settings · Router & Security',
        subtitle: 'Task routing, privacy guard, scan roots',
        icon: <Settings className="w-4 h-4" />,
        action: () => {
          onNavigate('settings');
          onClose();
        },
      },
    ];

    for (const p of state.projects) {
      items.push({
        id: `proj-${p.id}`,
        group: 'Projects',
        title: p.name,
        subtitle: `${p.filesCount} files · ${p.description}`,
        icon: <FolderKanban className="w-4 h-4 text-amber-500" />,
        action: () => {
          onNavigate('projects', { projectId: p.id, inspector: { kind: 'project', projectId: p.id } });
          onClose();
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
          onClose();
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
          onClose();
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
          onClose();
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
          onClose();
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
          onClose();
        },
      });
    }

    return items;
  }, [state, onNavigate, onCreateChat, onToggleInspector, onToggleRunLog, onToggleTheme, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 14);
    return allItems
      .filter((item) => `${item.title} ${item.subtitle} ${item.group}`.toLowerCase().includes(q))
      .slice(0, 16);
  }, [allItems, query]);

  const handleClose = () => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  };

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      filtered[activeIndex].action();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-slate-950/60 backdrop-blur-xs"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Bar"
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
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
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No matching records across Brain, Wiki, Chats, Projects, or Agents.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const selected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  onMouseEnter={() => setActiveIndex(idx)}
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
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.subtitle}</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">{item.group}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-[11px] text-slate-500">
          <span>Navigate with Up/Down · Enter to open · Esc to dismiss</span>
          <span className="font-mono tabular-nums">{filtered.length} results</span>
        </div>
      </div>
    </div>
  );
}
