'use client';

import React, { useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import {
  Bot,
  BookOpen,
  Brain,
  FolderKanban,
  Loader2,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/seed-data';
import { retrieveHybridContext } from '@/lib/rag';
import type {
  ChatMessage,
  ChatMode,
  ChatThread,
  CortexState,
  InspectorTarget,
  KnowledgeTab,
  ModuleId,
  RunLogEntry,
} from '@/lib/types';

interface ChatModuleProps {
  state: CortexState;
  activeChatId: string;
  onUpdateChat: (chatId: string, updater: (prev: ChatThread) => ChatThread) => void;
  onAddLog: (entry: Omit<RunLogEntry, 'id' | 'timestamp'>) => void;
  onNavigate: (module: ModuleId, opts?: { knowledgeTab?: KnowledgeTab; inspector?: InspectorTarget }) => void;
  onCreateChat: (mode?: ChatMode) => void;
}

const CHAT_MODES: Array<{ id: ChatMode; label: string; icon: React.ReactNode }> = [
  { id: 'new', label: 'Standard', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: 'project', label: 'Project Chat', icon: <FolderKanban className="w-3.5 h-3.5" /> },
  { id: 'multi-agent', label: 'Multi-Agent', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'brain', label: 'Brain Chat', icon: <Brain className="w-3.5 h-3.5" /> },
  { id: 'wiki', label: 'Wiki Chat', icon: <BookOpen className="w-3.5 h-3.5" /> },
];

export function ChatModule({
  state,
  activeChatId,
  onUpdateChat,
  onAddLog,
  onNavigate,
  onCreateChat,
}: ChatModuleProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const chat = useMemo(
    () => state.chats.find((c) => c.id === activeChatId) ?? state.chats[0],
    [state.chats, activeChatId]
  );

  if (!chat) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-slate-500 mb-3">No active chat thread.</p>
        <button
          type="button"
          onClick={() => onCreateChat('new')}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
        >
          Start Conversation
        </button>
      </div>
    );
  }

  const activeAgent = state.agents.find((a) => a.id === chat.agentId) ?? state.agents[0];
  const activeProject = state.projects.find((p) => p.id === chat.projectId) ?? null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setErrorMsg(null);
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    const nextTitle =
      chat.messages.length === 0 ? trimmed.slice(0, 48) + (trimmed.length > 48 ? '...' : '') : chat.title;

    onUpdateChat(chat.id, (prev) => ({
      ...prev,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
      messages: [...prev.messages, userMsg],
    }));
    setInput('');
    setSending(true);

    // Hybrid RAG retrieval
    const rag = useRag
      ? retrieveHybridContext({
          query: trimmed,
          brainItems: state.brainItems,
          wikiPages: state.wikiPages,
          graphNodes: state.graphNodes,
          graphEdges: state.graphEdges,
          activeProjectId: chat.mode === 'project' ? chat.projectId : null,
          includeBrain: chat.mode !== 'wiki',
          includeWiki: chat.mode !== 'brain',
        })
      : { citations: [], contextPrompt: '' };

    if (useRag && rag.citations.length > 0) {
      onAddLog({
        source: 'RAG',
        level: 'info',
        message: `Retrieved ${rag.citations.length} context source(s) for ${activeAgent?.name ?? 'Chat'}`,
        detail: rag.citations.map((c) => c.title).join(', '),
      });
    }

    try {
      const multiAgentInstruction =
        chat.mode === 'multi-agent'
          ? `${activeAgent?.systemPrompt ?? ''}\n\nMULTI-AGENT MODE: Synthesize perspectives from Hermes (research), Architect (systems), and Grok (critique) before giving a unified recommendation.`
          : activeAgent?.systemPrompt;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...chat.messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          mode: chat.mode,
          modelId: chat.modelId,
          agentName: chat.mode === 'multi-agent' ? 'Multi-Agent Council' : activeAgent?.name,
          agentSystemPrompt: multiAgentInstruction,
          projectName: activeProject?.name ?? null,
          ragContext: useRag ? rag.contextPrompt : '',
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        routedVia?: string;
        latencyMs?: number;
        error?: string;
      };

      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'Chat request failed.');
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
        agentId: activeAgent?.id,
        agentName: chat.mode === 'multi-agent' ? 'Multi-Agent Council' : activeAgent?.name,
        modelLabel: data.routedVia ?? chat.modelId,
        citations: rag.citations,
        latencyMs: data.latencyMs,
      };

      onUpdateChat(chat.id, (prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        messages: [...prev.messages, assistantMsg],
      }));

      onAddLog({
        source: 'Router',
        level: 'success',
        message: `${data.routedVia ?? chat.modelId} responded in ${data.latencyMs ?? 0}ms`,
        detail: `${rag.citations.length} RAG citations attached`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach AI Router.';
      setErrorMsg(msg);
      onAddLog({
        source: 'Router',
        level: 'error',
        message: msg,
      });
    } finally {
      setSending(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top Chat Toolbar: Mode Tabs + Model Selector + Agent Selector + Project Scope */}
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 overflow-x-auto">
          {CHAT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onUpdateChat(chat.id, (prev) => ({ ...prev, mode: m.id }))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chat.mode === m.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Provider/Model Selector */}
          <select
            aria-label="Select Model"
            value={chat.modelId}
            onChange={(e) => onUpdateChat(chat.id, (prev) => ({ ...prev, modelId: e.target.value }))}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.providerLabel} · {m.label}
              </option>
            ))}
          </select>

          {/* Agent Persona Selector */}
          <select
            aria-label="Select Agent"
            value={chat.agentId}
            onChange={(e) => onUpdateChat(chat.id, (prev) => ({ ...prev, agentId: e.target.value }))}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {state.agents.map((a) => (
              <option key={a.id} value={a.id}>
                Agent: {a.name}
              </option>
            ))}
          </select>

          {/* Project Space Scope */}
          <select
            aria-label="Select Project Scope"
            value={chat.projectId ?? ''}
            onChange={(e) =>
              onUpdateChat(chat.id, (prev) => ({ ...prev, projectId: e.target.value || null }))
            }
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Global Scope</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                Project: {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setUseRag((v) => !v)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              useRag
                ? 'border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-500'
            }`}
          >
            RAG: {useRag ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Messages Viewport */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6 max-w-4xl w-full mx-auto">
        {chat.messages.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Bot className="w-8 h-8 text-indigo-500 mx-auto" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {activeAgent?.name} · {chat.mode === 'brain' ? 'Brain Chat' : chat.mode === 'wiki' ? 'Wiki Chat' : 'Ready'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Ask a question across your Second Brain vault, compiled LLM Wiki, or isolated project context.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {[
                'How does our Hybrid RAG pipeline prevent project cross-talk?',
                'Summarize our safe subagent delegation limits',
                'Give me a hook for Episode 14 using our MCP notes',
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {msg.agentName ?? 'Assistant'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{msg.modelLabel ?? chat.modelId}</span>
                    {msg.latencyMs !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{msg.latencyMs}ms</span>
                      </>
                    )}
                  </div>
                )}

                <div
                  className={`prose prose-sm max-w-none ${
                    msg.role === 'user' ? 'prose-invert' : 'dark:prose-invert'
                  }`}
                >
                  <Markdown>{msg.content}</Markdown>
                </div>

                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-600 dark:text-slate-300">Sources:</span>
                    {msg.citations.map((cit) => (
                      <button
                        key={cit.id}
                        type="button"
                        onClick={() => {
                          if (cit.sourceType === 'brain') {
                            onNavigate('knowledge', {
                              knowledgeTab: 'brain',
                              inspector: { kind: 'brain', itemId: cit.id },
                            });
                          } else if (cit.sourceType === 'wiki') {
                            onNavigate('knowledge', {
                              knowledgeTab: 'wiki',
                              inspector: { kind: 'wiki', pageId: cit.id },
                            });
                          } else {
                            onNavigate('knowledge', {
                              knowledgeTab: 'graph',
                              inspector: { kind: 'node', nodeId: cit.id },
                            });
                          }
                        }}
                        className="hover:text-indigo-500 underline decoration-slate-300 dark:decoration-slate-700 underline-offset-2"
                      >
                        {cit.title} ({cit.sourceType})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
            <span>Routing request through {activeAgent?.name} and Knowledge Engine...</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="px-4 sm:px-8 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 shrink-0"
      >
        <div className="max-w-4xl mx-auto flex items-center gap-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${activeAgent?.name ?? 'CORTEX'} (${activeProject ? activeProject.name : 'Global Workspace'})...`}
            className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </div>
      </form>
    </div>
  );
}
