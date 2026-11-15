'use client';

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Download,
  FolderKanban,
  MessageSquare,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  CortexState,
  InspectorTarget,
  KnowledgeTab,
  ModuleId,
  ProjectSpace,
} from '@/lib/types';

interface ProjectsModuleProps {
  state: CortexState;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onCreateProject: (project: ProjectSpace) => void;
  onToggleTask: (taskId: string) => void;
  onAddTask: (projectId: string, title: string) => void;
  onNavigate: (module: ModuleId, opts?: { knowledgeTab?: KnowledgeTab; inspector?: InspectorTarget; chatId?: string }) => void;
  onStartProjectChat: (projectId: string) => void;
  onInspect: (target: InspectorTarget) => void;
}

export function ProjectsModule({
  state,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onToggleTask,
  onAddTask,
  onNavigate,
  onStartProjectChat,
  onInspect,
}: ProjectsModuleProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftPath, setDraftPath] = useState('');

  const project = useMemo(
    () => state.projects.find((p) => p.id === selectedProjectId) ?? state.projects[0],
    [state.projects, selectedProjectId]
  );

  const projectMemories = useMemo(
    () => state.brainItems.filter((b) => b.projectId === project?.id),
    [state.brainItems, project]
  );
  const projectChats = useMemo(
    () => state.chats.filter((c) => c.projectId === project?.id),
    [state.chats, project]
  );
  const projectTasks = useMemo(
    () => state.tasks.filter((t) => t.projectId === project?.id),
    [state.tasks, project]
  );

  const handleExportClaudeMd = () => {
    if (!project) return;
    const content = [
      `# ${project.name} — CORTEX Project Context`,
      '',
      `> Namespace: \`${project.slug}\` (Isolated)`,
      `> Root: \`${project.rootPath}\``,
      '',
      '## Project Overview',
      project.description,
      '',
      '## Active Tasks',
      ...projectTasks.map((t) => `- [${t.status === 'done' ? 'x' : ' '}] ${t.title}`),
      '',
      '## Key Memories',
      ...projectMemories.map((m) => `### ${m.title}\n${m.content}`),
      '',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.slug}.CLAUDE.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim()) return;
    const slug = draftName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const created: ProjectSpace = {
      id: `proj-${Date.now()}`,
      name: draftName.trim(),
      slug,
      description: draftDesc.trim() || 'Isolated project workspace.',
      rootPath: draftPath.trim() || `~/workspace/projects/${slug}`,
      defaultAgentId: 'architect',
      filesCount: 0,
      updatedAt: new Date().toISOString(),
      isolated: true,
    };
    onCreateProject(created);
    onSelectProject(created.id);
    onInspect({ kind: 'project', projectId: created.id });
    setShowNewModal(false);
    setDraftName('');
    setDraftDesc('');
    setDraftPath('');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Project Spaces
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Every project has isolated memories, files, chats, tasks, and CLAUDE.md / AGENTS.md exports.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          New Project Space
        </button>
      </div>

      {/* Project Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {state.projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onSelectProject(p.id);
              onInspect({ kind: 'project', projectId: p.id });
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              project?.id === p.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-200'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      {project && (
        <div className="space-y-6">
          {/* Project Header Card */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{project.name}</h2>
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Isolated Namespace
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{project.description}</p>
              <div className="text-xs font-mono text-slate-500 pt-1">
                {project.rootPath} · {project.filesCount} indexed files · {projectMemories.length} memories
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportClaudeMd}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export CLAUDE.md
              </button>
              <button
                type="button"
                onClick={() => onStartProjectChat(project.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 whitespace-nowrap"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Project Chat
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Project Tasks */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Tasks ({projectTasks.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70 flex-1">
                {projectTasks.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">No tasks in this project yet.</div>
                ) : (
                  projectTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onToggleTask(task.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      {task.status === 'done' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span
                        className={`text-sm ${
                          task.status === 'done'
                            ? 'line-through text-slate-400'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {task.title}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTaskTitle.trim()) return;
                  onAddTask(project.id, newTaskTitle.trim());
                  setNewTaskTitle('');
                }}
                className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2"
              >
                <input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add project task..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                >
                  Add
                </button>
              </form>
            </section>

            {/* Isolated Memories & Chats */}
            <div className="space-y-6">
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Project Memories ({projectMemories.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('knowledge', { knowledgeTab: 'inbox' })}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    + Ingest Document
                  </button>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {projectMemories.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">No scoped memories yet.</div>
                  ) : (
                    projectMemories.map((mem) => (
                      <button
                        key={mem.id}
                        type="button"
                        onClick={() =>
                          onNavigate('knowledge', {
                            knowledgeTab: 'brain',
                            inspector: { kind: 'brain', itemId: mem.id },
                          })
                        }
                        className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-white">{mem.title}</div>
                        <div className="mt-1 text-xs text-slate-500 line-clamp-1">{mem.content}</div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Project Chats ({projectChats.length})
                  </h3>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {projectChats.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">No project chats yet.</div>
                  ) : (
                    projectChats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          onNavigate('chat', { chatId: c.id, inspector: { kind: 'chat', chatId: c.id } })
                        }
                        className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 flex justify-between text-xs"
                      >
                        <span className="font-medium text-slate-900 dark:text-slate-100">{c.title}</span>
                        <span className="font-mono tabular-nums text-slate-500">{c.messages.length} msgs</span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Create Project Space</h3>
              <button type="button" onClick={() => setShowNewModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Project Name</label>
                <input
                  required
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g., Autonomous Docs Engine"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Root Path</label>
                <input
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder="~/workspace/projects/..."
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea
                  rows={2}
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white">
                  Create Space
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
