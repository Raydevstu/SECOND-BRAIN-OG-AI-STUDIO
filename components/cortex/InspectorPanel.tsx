'use client';

import React from 'react';
import {
  Bot,
  Brain,
  FileCode2,
  FolderKanban,
  GitBranch,
  Link2,
  MessageSquare,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import type { CortexState, InspectorTarget, KnowledgeTab, ModuleId } from '@/lib/types';

interface InspectorPanelProps {
  state: CortexState;
  target: InspectorTarget;
  onClose: () => void;
  onSelectTarget: (target: InspectorTarget) => void;
  onNavigate: (module: ModuleId, opts?: { knowledgeTab?: KnowledgeTab; inspector?: InspectorTarget }) => void;
}

export function InspectorPanel({
  state,
  target,
  onClose,
  onSelectTarget,
  onNavigate,
}: InspectorPanelProps) {
  const renderBody = () => {
    if (target.kind === 'chat') {
      const chat = state.chats.find((c) => c.id === target.chatId);
      if (!chat) return <EmptyInspector label="Select a conversation to inspect RAG citations and routing." />;
      const agent = state.agents.find((a) => a.id === chat.agentId);
      const lastAssistant = [...chat.messages].reverse().find((m) => m.role === 'assistant');

      return (
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat Context</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{chat.title}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {chat.mode} mode · {chat.modelId}
            </p>
          </div>

          {agent && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Agent</div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-900 dark:text-slate-100">{agent.name}</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {agent.budget.maxTokensPerRun.toLocaleString()} tok cap
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Memory read: {agent.memory.read.join(', ')}
              </p>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Retrieved RAG Sources ({lastAssistant?.citations?.length ?? 0})
            </div>
            {lastAssistant?.citations && lastAssistant.citations.length > 0 ? (
              <div className="space-y-2">
                {lastAssistant.citations.map((cit) => (
                  <button
                    key={cit.id}
                    type="button"
                    onClick={() => {
                      if (cit.sourceType === 'brain') {
                        onNavigate('knowledge', { knowledgeTab: 'brain', inspector: { kind: 'brain', itemId: cit.id } });
                      } else if (cit.sourceType === 'wiki') {
                        onNavigate('knowledge', { knowledgeTab: 'wiki', inspector: { kind: 'wiki', pageId: cit.id } });
                      } else {
                        onNavigate('knowledge', { knowledgeTab: 'graph', inspector: { kind: 'node', nodeId: cit.id } });
                      }
                    }}
                    className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                  >
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{cit.title}</div>
                    <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500">
                      {cit.sourceType} · score {cit.score}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Send a prompt to inspect retrieved Brain, Wiki, and Graph citations.</p>
            )}
          </div>
        </div>
      );
    }

    if (target.kind === 'agent') {
      const agent = state.agents.find((a) => a.id === target.agentId);
      if (!agent) return <EmptyInspector label="Select an agent definition to inspect permissions and JSON config." />;
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Bot className="w-3.5 h-3.5" />
              <span>AgentDefinition · v{agent.version}</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{agent.name}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{agent.description}</p>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Provider</span>
              <span className="font-mono text-slate-900 dark:text-slate-100">{agent.provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Primary Model</span>
              <span className="font-mono text-slate-900 dark:text-slate-100">{agent.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Budget Cap</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                ${agent.budget.maxCostUsd.toFixed(2)} · {agent.budget.maxTokensPerRun.toLocaleString()} tok
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Delegation</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {agent.delegation.canSpawn ? `depth ${agent.delegation.maxDepth} · max ${agent.delegation.maxConcurrent}` : 'disabled'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Filesystem / Shell</span>
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {agent.permissions.fs} · {agent.permissions.shell}
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">JSON Definition</div>
            <pre className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-72">
              {JSON.stringify(agent, null, 2)}
            </pre>
          </div>
        </div>
      );
    }

    if (target.kind === 'brain') {
      const item = state.brainItems.find((b) => b.id === target.itemId);
      if (!item) return <EmptyInspector label="Select a Brain note to inspect backlinks and tags." />;
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Brain className="w-3.5 h-3.5" />
              <span>Brain Vault · {item.folder}</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
            <p className="mt-1 text-xs text-slate-500">{item.tags.join(' · ')}</p>
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-xs font-medium text-slate-500">Backlinks ({item.backlinks.length})</div>
            {item.backlinks.length === 0 ? (
              <p className="text-xs text-slate-500">No linked nodes yet.</p>
            ) : (
              item.backlinks.map((id) => {
                const wiki = state.wikiPages.find((w) => w.id === id);
                const brain = state.brainItems.find((b) => b.id === id);
                const label = wiki?.title ?? brain?.title ?? id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      onSelectTarget(wiki ? { kind: 'wiki', pageId: wiki.id } : { kind: 'brain', itemId: id })
                    }
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-left hover:border-indigo-400"
                  >
                    <Link2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      );
    }

    if (target.kind === 'wiki') {
      const page = state.wikiPages.find((w) => w.id === target.pageId);
      if (!page) return <EmptyInspector label="Select a Wiki topic page to inspect compiled sources." />;
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <FileCode2 className="w-3.5 h-3.5" />
              <span>LLM Wiki · {page.category}</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{page.title}</h3>
            <p className="mt-1 text-xs text-slate-500">Compiled by {page.compiledBy}</p>
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-xs font-medium text-slate-500">Source Citations ({page.citations.length})</div>
            {page.citations.map((cid) => {
              const source = state.brainItems.find((b) => b.id === cid);
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => {
                    if (source) {
                      onNavigate('knowledge', { knowledgeTab: 'brain', inspector: { kind: 'brain', itemId: source.id } });
                    }
                  }}
                  className="w-full text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:border-indigo-400"
                >
                  {source ? source.title : cid}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (target.kind === 'node') {
      const node = state.graphNodes.find((n) => n.id === target.nodeId);
      if (!node) return <EmptyInspector label="Click any node in the Knowledge Graph to inspect its relations." />;
      const edges = state.graphEdges.filter((e) => e.source === node.id || e.target === node.id);
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <GitBranch className="w-3.5 h-3.5" />
              <span>Graph Node · {node.type}</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{node.label}</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">{node.summary}</p>
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-xs font-medium text-slate-500">Connected Edges ({edges.length})</div>
            {edges.map((e) => {
              const outgoing = e.source === node.id;
              const peerId = outgoing ? e.target : e.source;
              const peer = state.graphNodes.find((n) => n.id === peerId);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => peer && onSelectTarget({ kind: 'node', nodeId: peer.id })}
                  className="w-full flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:border-indigo-400"
                >
                  <span className="truncate font-medium">{peer?.label ?? peerId}</span>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">
                    {outgoing ? `-> ${e.relation}` : `<- ${e.relation}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (target.kind === 'project') {
      const project = state.projects.find((p) => p.id === target.projectId);
      if (!project) return <EmptyInspector label="Select a Project Space to view memory boundaries." />;
      const memories = state.brainItems.filter((b) => b.projectId === project.id);
      const tasks = state.tasks.filter((t) => t.projectId === project.id);
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Isolated Project Space</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{project.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{project.description}</p>
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Root Path</span>
              <span className="font-mono text-slate-900 dark:text-slate-100 truncate max-w-[150px]">{project.rootPath}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Brain Memories</span>
              <span className="font-mono tabular-nums">{memories.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Project Tasks</span>
              <span className="font-mono tabular-nums">{tasks.length}</span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 pt-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Namespace isolated during RAG recall</span>
            </div>
          </div>
        </div>
      );
    }

    if (target.kind === 'workflow') {
      const wf = state.workflows.find((w) => w.id === target.workflowId);
      if (!wf) return <EmptyInspector label="Select a workflow pipeline to inspect triggers and steps." />;
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <Workflow className="w-3.5 h-3.5" />
              <span>Workflow Pipeline</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{wf.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{wf.description}</p>
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            {wf.steps.map((step, i) => (
              <div key={step.id} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {i + 1}. {step.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {step.kind} · {step.configSummary}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return <EmptyInspector label="Select any chat, agent, note, node, or project to inspect live details." />;
  };

  return (
    <aside className="w-[300px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col h-full overflow-hidden">
      <div className="h-11 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold tracking-tight text-slate-700 dark:text-slate-200">Inspector</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
          aria-label="Close Inspector"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{renderBody()}</div>
    </aside>
  );
}

function EmptyInspector({ label }: { label: string }) {
  return (
    <div className="py-12 text-center space-y-2">
      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">No Active Selection</div>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{label}</p>
    </div>
  );
}
