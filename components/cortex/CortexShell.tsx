'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  Brain,
  ChevronDown,
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
  Zap,
} from 'lucide-react';
import { INITIAL_CORTEX_STATE } from '@/lib/seed-data';
import { BOTTOM_NAV_ITEMS, PRIMARY_NAV_ITEMS } from '@/mock/nav';
import type {
  AgentDefinition,
  BrainItem,
  ChatMode,
  ChatThread,
  CortexState,
  GraphEdge,
  GraphNode,
  InspectorTarget,
  KnowledgeTab,
  ModuleId,
  NavIconName,
  ProjectSpace,
  RouterSettings,
  RunLogEntry,
  WikiPage,
  WorkflowDef,
} from '@/lib/types';
import { CommandPalette } from './CommandPalette';
import { InspectorPanel } from './InspectorPanel';
import { HomeModule } from './modules/HomeModule';
import { ChatModule } from './modules/ChatModule';
import { AgentsModule } from './modules/AgentsModule';
import { KnowledgeModule } from './modules/KnowledgeModule';
import { ProjectsModule } from './modules/ProjectsModule';
import { WorkflowsModule } from './modules/WorkflowsModule';
import { PluginsModule } from './modules/PluginsModule';
import { SettingsModule } from './modules/SettingsModule';

const STORAGE_KEY = 'cortex-harness-state-v1';
const CONTEXT_PANEL_STORAGE_KEY = 'cortex-context-panel-open';

const NAV_ICONS: Record<NavIconName, React.ReactNode> = {
  home: <Home className="w-[18px] h-[18px]" />,
  chat: <MessageSquare className="w-[18px] h-[18px]" />,
  agents: <Bot className="w-[18px] h-[18px]" />,
  knowledge: <Brain className="w-[18px] h-[18px]" />,
  projects: <FolderKanban className="w-[18px] h-[18px]" />,
  workflows: <Zap className="w-[18px] h-[18px]" />,
  plugins: <Puzzle className="w-[18px] h-[18px]" />,
  settings: <Settings className="w-[18px] h-[18px]" />,
};

export function CortexShell() {
  const [state, setState] = useState<CortexState>(INITIAL_CORTEX_STATE);
  const [hydrated, setHydrated] = useState(false);

  const [activeModule, setActiveModule] = useState<ModuleId>('home');
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>('brain');
  const [activeChatId, setActiveChatId] = useState<string>(INITIAL_CORTEX_STATE.chats[0].id);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(INITIAL_CORTEX_STATE.agents[0].id);
  const [selectedBrainId, setSelectedBrainId] = useState<string>(INITIAL_CORTEX_STATE.brainItems[0].id);
  const [selectedWikiId, setSelectedWikiId] = useState<string>(INITIAL_CORTEX_STATE.wikiPages[0].id);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(INITIAL_CORTEX_STATE.projects[0].id);

  const [contextOpen, setContextOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [runLogOpen, setRunLogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget>({
    kind: 'chat',
    chatId: INITIAL_CORTEX_STATE.chats[0].id,
  });

  // Load persisted state on mount asynchronously to preserve SSR hydration
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as CortexState;
          if (parsed && Array.isArray(parsed.agents) && Array.isArray(parsed.projects)) {
            setState(parsed);
          }
        }
        const savedContextOpen = localStorage.getItem(CONTEXT_PANEL_STORAGE_KEY);
        if (savedContextOpen === 'true') setContextOpen(true);
        else if (savedContextOpen === 'false') setContextOpen(false);
      } catch {
        // Ignore corrupt localStorage and fall back to seed
      }
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Persist state & sync dark mode class
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(CONTEXT_PANEL_STORAGE_KEY, String(contextOpen));
    } catch {
      // Ignore storage quota errors
    }
  }, [contextOpen, hydrated]);

  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [state.settings.theme]);

  // Global Ctrl+K / Cmd+K and Ctrl+B / Cmd+B listeners
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key === 'b') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setContextOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addLog = useCallback((entry: Omit<RunLogEntry, 'id' | 'timestamp'>) => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    setState((prev) => ({
      ...prev,
      runLogs: [
        { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: ts, ...entry },
        ...prev.runLogs,
      ].slice(0, 60),
    }));
  }, []);

  const handleNavigate = useCallback(
    (
      mod: ModuleId,
      opts?: {
        knowledgeTab?: KnowledgeTab;
        inspector?: InspectorTarget;
        chatId?: string;
        projectId?: string | null;
      }
    ) => {
      setActiveModule(mod);
      if (opts?.knowledgeTab) setKnowledgeTab(opts.knowledgeTab);
      if (opts?.chatId) setActiveChatId(opts.chatId);
      if (opts?.projectId) setSelectedProjectId(opts.projectId);
      if (opts?.inspector) {
        setInspectorTarget(opts.inspector);
        if (opts.inspector.kind === 'brain') setSelectedBrainId(opts.inspector.itemId);
        if (opts.inspector.kind === 'wiki') setSelectedWikiId(opts.inspector.pageId);
        if (opts.inspector.kind === 'agent') setSelectedAgentId(opts.inspector.agentId);
      } else {
        if (mod === 'chat') setInspectorTarget({ kind: 'chat', chatId: opts?.chatId ?? activeChatId });
        if (mod === 'agents') setInspectorTarget({ kind: 'agent', agentId: selectedAgentId });
        if (mod === 'projects') setInspectorTarget({ kind: 'project', projectId: opts?.projectId ?? selectedProjectId });
      }
    },
    [activeChatId, selectedAgentId, selectedProjectId]
  );

  const handleCreateChat = useCallback(
    (mode: ChatMode = 'new', projectId: string | null = null) => {
      const id = `chat-${Date.now()}`;
      const project = projectId ? state.projects.find((p) => p.id === projectId) : null;
      const newChat: ChatThread = {
        id,
        title: project ? `${project.name} Session` : 'New Conversation',
        mode,
        projectId,
        agentId: project?.defaultAgentId ?? 'hermes',
        modelId: state.settings.planningModel || 'gemini-4-hydrogen',
        messages: [],
        updatedAt: new Date().toISOString(),
      };
      setState((prev) => ({ ...prev, chats: [newChat, ...prev.chats] }));
      setActiveChatId(id);
      setActiveModule('chat');
      setInspectorTarget({ kind: 'chat', chatId: id });
    },
    [state.projects, state.settings.planningModel]
  );

  const handleUpdateChat = useCallback((chatId: string, updater: (prev: ChatThread) => ChatThread) => {
    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) => (c.id === chatId ? updater(c) : c)),
    }));
  }, []);

  const handleToggleTask = useCallback((taskId: string) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id === taskId ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t
      ),
    }));
  }, []);

  const handleAddTask = useCallback((projectId: string, title: string) => {
    setState((prev) => ({
      ...prev,
      tasks: [
        ...prev.tasks,
        { id: `task-${Date.now()}`, projectId, title, status: 'todo', assigneeAgentId: 'planner' },
      ],
    }));
  }, []);

  const handleSaveAgent = useCallback((agent: AgentDefinition) => {
    setState((prev) => {
      const exists = prev.agents.some((a) => a.id === agent.id);
      return {
        ...prev,
        agents: exists ? prev.agents.map((a) => (a.id === agent.id ? agent : a)) : [agent, ...prev.agents],
      };
    });
  }, []);

  const handleAddBrainItem = useCallback((item: BrainItem) => {
    setState((prev) => ({ ...prev, brainItems: [item, ...prev.brainItems] }));
  }, []);

  const handleUpdateBrainItem = useCallback((id: string, patch: Partial<BrainItem>) => {
    setState((prev) => ({
      ...prev,
      brainItems: prev.brainItems.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }, []);

  const handleUpsertWikiPage = useCallback((page: WikiPage) => {
    setState((prev) => {
      const exists = prev.wikiPages.some((w) => w.title.toLowerCase() === page.title.toLowerCase());
      return {
        ...prev,
        wikiPages: exists
          ? prev.wikiPages.map((w) => (w.title.toLowerCase() === page.title.toLowerCase() ? page : w))
          : [page, ...prev.wikiPages],
      };
    });
  }, []);

  const handleMergeGraph = useCallback((nodes: GraphNode[], edges: GraphEdge[]) => {
    setState((prev) => {
      const nodeIds = new Set(prev.graphNodes.map((n) => n.id));
      const newNodes = nodes.filter((n) => !nodeIds.has(n.id));
      return {
        ...prev,
        graphNodes: [...prev.graphNodes, ...newNodes],
        graphEdges: [...prev.graphEdges, ...edges],
      };
    });
  }, []);

  const handleCreateProject = useCallback((project: ProjectSpace) => {
    setState((prev) => ({ ...prev, projects: [...prev.projects, project] }));
  }, []);

  const handleToggleWorkflow = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      workflows: prev.workflows.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)),
    }));
  }, []);

  const handleRunWorkflow = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      workflows: prev.workflows.map((w) =>
        w.id === id ? { ...w, runCount: w.runCount + 1, lastRunAt: new Date().toISOString() } : w
      ),
    }));
  }, []);

  const handleCreateWorkflow = useCallback((wf: WorkflowDef) => {
    setState((prev) => ({ ...prev, workflows: [wf, ...prev.workflows] }));
  }, []);

  const handleTogglePlugin = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      plugins: prev.plugins.map((p) => (p.id === id ? { ...p, connected: !p.connected } : p)),
    }));
  }, []);

  const handleUpdateSettings = useCallback((patch: Partial<RouterSettings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const handleResetWorkspace = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(INITIAL_CORTEX_STATE);
    setActiveChatId(INITIAL_CORTEX_STATE.chats[0].id);
  }, []);

  const breadcrumbLabel = (() => {
    switch (activeModule) {
      case 'home':
        return 'Mission Control';
      case 'chat':
        return `Chat / ${state.chats.find((c) => c.id === activeChatId)?.title ?? 'Session'}`;
      case 'agents':
        return `Agents / ${state.agents.find((a) => a.id === selectedAgentId)?.name ?? 'Fleet'}`;
      case 'knowledge':
        return `Knowledge / ${knowledgeTab.charAt(0).toUpperCase() + knowledgeTab.slice(1)}`;
      case 'projects':
        return `Projects / ${state.projects.find((p) => p.id === selectedProjectId)?.name ?? 'Spaces'}`;
      case 'workflows':
        return 'Workflows';
      case 'plugins':
        return 'Plugins & MCP';
      case 'settings':
        return 'Settings';
    }
  })();

  const renderContextPanel = () => {
    if (activeModule === 'chat') {
      return (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleCreateChat('new')}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
          <div className="text-[11px] font-medium text-slate-400 pt-1">Conversations</div>
          <div className="space-y-1">
            {state.chats.map((c) => {
              const proj = state.projects.find((p) => p.id === c.projectId);
              const active = c.id === activeChatId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setActiveChatId(c.id);
                    setInspectorTarget({ kind: 'chat', chatId: c.id });
                  }}
                  className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                    active
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="text-xs font-medium truncate">{c.title}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {proj ? proj.name : 'Global'} · {c.mode}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (activeModule === 'agents') {
      return (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-slate-400 pb-1">Agent Fleet ({state.agents.length})</div>
          {state.agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setSelectedAgentId(a.id);
                setInspectorTarget({ kind: 'agent', agentId: a.id });
              }}
              className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                selectedAgentId === a.id
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="text-xs font-medium truncate">{a.name}</div>
              <div className="text-[11px] text-slate-500 truncate">{a.roleTag}</div>
            </button>
          ))}
        </div>
      );
    }

    if (activeModule === 'knowledge') {
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-slate-400 pb-1">Knowledge Views</div>
            {(['brain', 'wiki', 'graph', 'inbox'] as KnowledgeTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setKnowledgeTab(tab)}
                className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-medium capitalize ${
                  knowledgeTab === tab
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                {tab === 'inbox' ? 'Inbox (Librarian)' : tab}
              </button>
            ))}
          </div>

          <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] font-medium text-slate-400 pb-1">Recent Vault Notes</div>
            {state.brainItems.slice(0, 6).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setKnowledgeTab('brain');
                  setSelectedBrainId(b.id);
                  setInspectorTarget({ kind: 'brain', itemId: b.id });
                }}
                className="w-full px-2 py-1.5 rounded text-left text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 truncate"
              >
                {b.title}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activeModule === 'projects') {
      return (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-slate-400 pb-1">
            Project Spaces ({state.projects.length})
          </div>
          {state.projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelectedProjectId(p.id);
                setInspectorTarget({ kind: 'project', projectId: p.id });
              }}
              className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                selectedProjectId === p.id
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="text-xs font-medium truncate">{p.name}</div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">{p.filesCount} files</div>
            </button>
          ))}
        </div>
      );
    }

    if (activeModule === 'workflows') {
      return (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-slate-400 pb-1">Pipelines</div>
          {state.workflows.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setInspectorTarget({ kind: 'workflow', workflowId: w.id })}
              className="w-full px-2.5 py-2 rounded-lg text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800/60"
            >
              <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{w.name}</div>
              <div className="text-[11px] text-slate-500">
                {w.triggerType} · {w.enabled ? 'Active' : 'Paused'}
              </div>
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-slate-400 pb-1">Quick Jump</div>
          <button
            type="button"
            onClick={() => handleCreateChat('new')}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
          >
            + Start New Chat
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('knowledge', { knowledgeTab: 'inbox' })}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
          >
            Drop Note to Librarian
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('knowledge', { knowledgeTab: 'graph' })}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
          >
            Explore Knowledge Graph
          </button>
        </div>

        <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-medium text-slate-400 pb-1">Pinned Projects</div>
          {state.projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                handleNavigate('projects', {
                  projectId: p.id,
                  inspector: { kind: 'project', projectId: p.id },
                })
              }
              className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 truncate"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar (3-zone clean contract) */}
      <header className="h-12 px-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 shrink-0">
        {/* Zone 1: Brand + Context Toggle + Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            aria-label="Toggle Context Panel"
            title="Toggle Context Panel"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            CORTEX Harness
          </span>
          <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
          <span className="hidden sm:inline text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
            {breadcrumbLabel}
          </span>
        </div>

        {/* Zone 2: Ctrl+K Global Command Trigger */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden md:flex items-center justify-between gap-6 px-3 py-1.5 w-80 text-xs text-slate-500 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shrink-0"
        >
          <span className="inline-flex items-center gap-2">
            <Search className="w-3.5 h-3.5" />
            <span>Search Brain, Wiki, Chats, Agents...</span>
          </span>
          <kbd className="font-mono text-[10px] text-slate-400">Ctrl+K</kbd>
        </button>

        {/* Zone 3: Workspace Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="md:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setRunLogOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              runLogOpen
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Run Log</span>
          </button>
          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              inspectorOpen
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Inspector</span>
          </button>
          <button
            type="button"
            onClick={() =>
              handleUpdateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' })
            }
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            aria-label="Toggle Theme"
          >
            {state.settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main 4-Pane Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 1. Compact 48px Icon Rail */}
        <nav
          aria-label="Primary Workspace Rail"
          className="w-12 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col items-center justify-between py-2.5"
        >
          <div className="flex flex-col items-center gap-1.5">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const active = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  title={item.label}
                  aria-label={item.label}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {NAV_ICONS[item.icon]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            {BOTTOM_NAV_ITEMS.map((item) => {
              const active = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  title={item.label}
                  aria-label={item.label}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {NAV_ICONS[item.icon]}
                </button>
              );
            })}
          </div>
        </nav>

        {/* 2. Collapsible Context Panel (~248px) */}
        {contextOpen && (
          <aside className="hidden md:flex w-[248px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex-col overflow-hidden">
            <div className="h-11 px-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">
                {activeModule}
              </span>
              <span className="text-[11px] font-mono text-slate-400">Context</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">{renderContextPanel()}</div>
          </aside>
        )}

        {/* 3. Active Workspace + Toggleable Run Log Drawer */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <main className="flex-1 overflow-y-auto min-h-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeModule}-${activeModule === 'knowledge' ? knowledgeTab : 'base'}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14 }}
                className="h-full"
              >
                {activeModule === 'home' && (
                  <HomeModule
                    state={state}
                    onNavigate={handleNavigate}
                    onToggleTask={handleToggleTask}
                    onCreateChat={() => handleCreateChat('new')}
                  />
                )}
                {activeModule === 'chat' && (
                  <ChatModule
                    state={state}
                    activeChatId={activeChatId}
                    onUpdateChat={handleUpdateChat}
                    onAddLog={addLog}
                    onNavigate={handleNavigate}
                    onCreateChat={(mode) => handleCreateChat(mode ?? 'new')}
                  />
                )}
                {activeModule === 'agents' && (
                  <AgentsModule
                    state={state}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={setSelectedAgentId}
                    onSaveAgent={handleSaveAgent}
                    onSaveMemoryNote={(title, content, tags) =>
                      handleAddBrainItem({
                        id: `brain-${Date.now()}`,
                        title,
                        folder: 'Memories',
                        projectId: null,
                        tags,
                        content,
                        backlinks: [],
                        updatedAt: new Date().toISOString(),
                        source: 'Agent Memory Promotion',
                      })
                    }
                    onAddLog={addLog}
                    onInspect={setInspectorTarget}
                  />
                )}
                {activeModule === 'knowledge' && (
                  <KnowledgeModule
                    state={state}
                    activeTab={knowledgeTab}
                    onTabChange={setKnowledgeTab}
                    selectedBrainId={selectedBrainId}
                    onSelectBrain={setSelectedBrainId}
                    selectedWikiId={selectedWikiId}
                    onSelectWiki={setSelectedWikiId}
                    onAddBrainItem={handleAddBrainItem}
                    onUpdateBrainItem={handleUpdateBrainItem}
                    onUpsertWikiPage={handleUpsertWikiPage}
                    onMergeGraph={handleMergeGraph}
                    onAddLog={addLog}
                    onInspect={setInspectorTarget}
                  />
                )}
                {activeModule === 'projects' && (
                  <ProjectsModule
                    state={state}
                    selectedProjectId={selectedProjectId}
                    onSelectProject={setSelectedProjectId}
                    onCreateProject={handleCreateProject}
                    onToggleTask={handleToggleTask}
                    onAddTask={handleAddTask}
                    onNavigate={handleNavigate}
                    onStartProjectChat={(pid) => handleCreateChat('project', pid)}
                    onInspect={setInspectorTarget}
                  />
                )}
                {activeModule === 'workflows' && (
                  <WorkflowsModule
                    state={state}
                    onToggleWorkflow={handleToggleWorkflow}
                    onRunWorkflow={handleRunWorkflow}
                    onCreateWorkflow={handleCreateWorkflow}
                    onAddLog={addLog}
                    onInspect={setInspectorTarget}
                  />
                )}
                {activeModule === 'plugins' && (
                  <PluginsModule state={state} onTogglePlugin={handleTogglePlugin} />
                )}
                {activeModule === 'settings' && (
                  <SettingsModule
                    state={state}
                    onUpdateSettings={handleUpdateSettings}
                    onResetWorkspace={handleResetWorkspace}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Toggleable Run Log / Terminal Drawer */}
          {runLogOpen && (
            <section className="h-44 shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col">
              <div className="px-4 py-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                  <Terminal className="w-3.5 h-3.5 text-slate-400" />
                  <span>Runtime Execution Log</span>
                  <span className="font-mono tabular-nums text-slate-400">({state.runLogs.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRunLogOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Collapse Run Log"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs space-y-1">
                {state.runLogs.map((entry) => (
                  <div key={entry.id} className="flex items-baseline gap-3">
                    <span className="text-slate-400 tabular-nums shrink-0">{entry.timestamp}</span>
                    <span
                      className={`w-16 shrink-0 ${
                        entry.level === 'error'
                          ? 'text-red-500'
                          : entry.level === 'warn'
                          ? 'text-amber-500'
                          : entry.level === 'success'
                          ? 'text-emerald-500'
                          : 'text-indigo-500'
                      }`}
                    >
                      {entry.source}
                    </span>
                    <span className="text-slate-800 dark:text-slate-200">{entry.message}</span>
                    {entry.detail && <span className="text-slate-400 truncate">— {entry.detail}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* 4. Collapsible Right Inspector */}
        {inspectorOpen && (
          <div className="hidden xl:flex">
            <InspectorPanel
              state={state}
              target={inspectorTarget}
              onClose={() => setInspectorOpen(false)}
              onSelectTarget={setInspectorTarget}
              onNavigate={handleNavigate}
            />
          </div>
        )}
      </div>

      {/* Ctrl+K Command Bar */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        state={state}
        onNavigate={handleNavigate}
        onCreateChat={() => handleCreateChat('new')}
        onToggleTheme={() =>
          handleUpdateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' })
        }
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        onToggleRunLog={() => setRunLogOpen((v) => !v)}
      />
    </div>
  );
}
