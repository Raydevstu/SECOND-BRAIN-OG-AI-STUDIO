'use client';

import React from 'react';
import {
  ArrowUpRight,
  Bot,
  Brain,
  CheckCircle2,
  Circle,
  Clock,
  FolderKanban,
  MessageSquare,
  Pin,
  Plus,
} from 'lucide-react';
import type { CortexState, InspectorTarget, KnowledgeTab, ModuleId } from '@/lib/types';

interface HomeModuleProps {
  state: CortexState;
  onNavigate: (
    module: ModuleId,
    opts?: { knowledgeTab?: KnowledgeTab; inspector?: InspectorTarget; chatId?: string; projectId?: string | null }
  ) => void;
  onToggleTask: (taskId: string) => void;
  onCreateChat: () => void;
}

export function HomeModule({ state, onNavigate, onToggleTask, onCreateChat }: HomeModuleProps) {
  const pinnedNotes = state.brainItems.filter((b) => b.pinned);
  const openTasks = state.tasks.filter((t) => t.status !== 'done');
  const completedTasks = state.tasks.filter((t) => t.status === 'done').length;

  const metrics = [
    {
      label: 'Brain Memories',
      value: state.brainItems.length,
      detail: `${state.wikiPages.length} compiled Wiki pages`,
    },
    {
      label: 'Knowledge Graph',
      value: state.graphNodes.length,
      detail: `${state.graphEdges.length} typed relations`,
    },
    {
      label: 'Active Agents',
      value: state.agents.length,
      detail: `${state.workflows.filter((w) => w.enabled).length} automations active`,
    },
    {
      label: 'Project Spaces',
      value: state.projects.length,
      detail: `${completedTasks}/${state.tasks.length} tasks verified`,
    },
  ];

  const folderDistribution = ['Memories', 'Ideas', 'Notes', 'Goals', 'Tasks'].map((folder) => ({
    folder,
    count: state.brainItems.filter((b) => b.folder === folder).length,
  }));
  const maxFolderCount = Math.max(1, ...folderDistribution.map((f) => f.count));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            AI Mission Control
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Unified shell across your provider router, agent runtime, Second Brain vault, and LLM Wiki.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('knowledge', { knowledgeTab: 'inbox' })}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Ingest to Librarian
          </button>
          <button
            type="button"
            onClick={onCreateChat}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>
      </div>

      {/* 4-Column Metric Strip (single-elevation) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
              {m.value}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{m.detail}</div>
          </div>
        ))}
      </div>

      {/* Main 2-Column Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Recent Chats + Recent Projects + Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Chats */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <MessageSquare className="w-4 h-4 text-indigo-500" />
                <span>Recent Chats</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('chat')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
              >
                Open Chat Workspace
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {state.chats.slice(0, 4).map((chat) => {
                const agent = state.agents.find((a) => a.id === chat.agentId);
                const project = state.projects.find((p) => p.id === chat.projectId);
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() =>
                      onNavigate('chat', { chatId: chat.id, inspector: { kind: 'chat', chatId: chat.id } })
                    }
                    className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {chat.title}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {agent?.name ?? 'Agent'} · {project ? project.name : 'Global'} · {chat.messages.length} messages
                      </div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </section>

          {/* Isolated Project Spaces */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <FolderKanban className="w-4 h-4 text-amber-500" />
                <span>Project Spaces</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('projects')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
              >
                Manage Projects
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800/70">
              {state.projects.slice(0, 4).map((proj, idx) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() =>
                    onNavigate('projects', {
                      projectId: proj.id,
                      inspector: { kind: 'project', projectId: proj.id },
                    })
                  }
                  className={`p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                    idx >= 2 ? 'border-t border-slate-100 dark:border-slate-800/70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {proj.name}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                      {proj.filesCount} files
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                    {proj.description}
                  </p>
                </button>
              ))}
            </div>
          </section>

          {/* Tasks */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Active Tasks ({openTasks.length} open)
              </div>
              <span className="text-xs text-slate-500 tabular-nums">{state.tasks.length} total</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {state.tasks.map((task) => {
                const project = state.projects.find((p) => p.id === task.projectId);
                const agent = state.agents.find((a) => a.id === task.assigneeAgentId);
                const done = task.status === 'done';
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onToggleTask(task.id)}
                    className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : task.status === 'in-progress' ? (
                        <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span
                        className={`text-sm truncate ${
                          done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 shrink-0 whitespace-nowrap">
                      {project?.name ?? 'Global'} · {agent?.name ?? 'Unassigned'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Column: Knowledge Growth + Pinned Notes + Agent Activity */}
        <div className="space-y-6">
          {/* Knowledge Growth Breakdown */}
          <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Brain className="w-4 h-4 text-emerald-500" />
                <span>Knowledge Footprint</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('knowledge', { knowledgeTab: 'graph' })}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View Graph
              </button>
            </div>
            <div className="space-y-2.5">
              {folderDistribution.map((row) => (
                <div key={row.folder} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">{row.folder}</span>
                    <span className="font-mono tabular-nums text-slate-500">{row.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${Math.max(8, (row.count / maxFolderCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Pinned Notes */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Pin className="w-4 h-4 text-slate-400" />
              <span>Pinned Memory Insights</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {pinnedNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() =>
                    onNavigate('knowledge', {
                      knowledgeTab: 'brain',
                      inspector: { kind: 'brain', itemId: note.id },
                    })
                  }
                  className="w-full p-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{note.title}</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{note.content}</p>
                  <div className="mt-1.5 text-[11px] text-slate-400">
                    {note.folder} · {note.tags.slice(0, 3).join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Agent & Runtime Activity */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Bot className="w-4 h-4 text-indigo-500" />
              <span>Recent Runtime Activity</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {state.runLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="px-4 py-2.5 text-xs">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="font-mono">{log.source}</span>
                    <span className="font-mono tabular-nums">{log.timestamp}</span>
                  </div>
                  <div className="mt-0.5 text-slate-800 dark:text-slate-200">{log.message}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
