'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import {
  Bot,
  Check,
  Copy,
  Download,
  Loader2,
  Play,
  Plus,
  Shield,
  Upload,
  X,
} from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/seed-data';
import { retrieveHybridContext } from '@/lib/rag';
import type { AgentDefinition, CortexState, InspectorTarget, ProviderId, RunLogEntry } from '@/lib/types';
import {
  detectIdConflict,
  diffPermissions,
  flagPromptSignals,
  parseImport,
  type IdConflictResult,
  type PermissionDiffItem,
} from './agents/importReview';
import { ImportReviewPanel } from './agents/ImportReviewPanel';

interface AgentsModuleProps {
  state: CortexState;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  onSaveAgent: (agent: AgentDefinition) => void;
  onSaveMemoryNote: (title: string, content: string, tags: string[]) => void;
  onAddLog: (entry: Omit<RunLogEntry, 'id' | 'timestamp'>) => void;
  onInspect: (target: InspectorTarget) => void;
}

export function AgentsModule({
  state,
  selectedAgentId,
  onSelectAgent,
  onSaveAgent,
  onSaveMemoryNote,
  onAddLog,
  onInspect,
}: AgentsModuleProps) {
  const [taskInput, setTaskInput] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    agentName: string;
    routedVia: string;
    latencyMs: number;
    planSteps: string[];
    toolCallsUsed: string[];
    memoryNote: string;
    finalOutput: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create / Import modal
  const [modalMode, setModalMode] = useState<'create' | 'import' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftRole, setDraftRole] = useState('Research + Execution');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftProvider, setDraftProvider] = useState<ProviderId>('gemini');
  const [draftModel, setDraftModel] = useState('gemini-4-hydrogen');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftTools, setDraftTools] = useState('memory.read, wiki.read, web.search');
  const [importJson, setImportJson] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStep, setImportStep] = useState<'edit' | 'review'>('edit');
  const [pendingReview, setPendingReview] = useState<{
    agent: AgentDefinition;
    diffs: PermissionDiffItem[];
    conflict: IdConflictResult;
    promptWarnings: string[];
  } | null>(null);
  const [highRiskAck, setHighRiskAck] = useState(false);
  const [importedIds, setImportedIds] = useState<Set<string>>(() => new Set());

  const closeModal = useCallback(() => {
    setModalMode(null);
    setImportStep('edit');
    setPendingReview(null);
    setImportJson('');
    setImportErrors([]);
    setHighRiskAck(false);
  }, []);

  const handleBackToEdit = useCallback(() => {
    setImportStep('edit');
    setPendingReview(null);
    setHighRiskAck(false);
  }, []);

  useEffect(() => {
    if (!modalMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (modalMode === 'import' && importStep === 'review') {
        handleBackToEdit();
        return;
      }
      if (modalMode === 'import' && importStep === 'edit' && importJson.trim().length > 0) {
        if (!window.confirm('Discard pasted Agent JSON?')) {
          return;
        }
      }
      closeModal();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalMode, importStep, importJson, closeModal, handleBackToEdit]);

  const selectedAgent = useMemo(
    () => state.agents.find((a) => a.id === selectedAgentId) ?? state.agents[0],
    [state.agents, selectedAgentId]
  );

  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !taskInput.trim() || running) return;
    setRunning(true);
    setRunError(null);

    const rag = retrieveHybridContext({
      query: taskInput,
      brainItems: state.brainItems,
      wikiPages: state.wikiPages,
      graphNodes: state.graphNodes,
      graphEdges: state.graphEdges,
      limit: 4,
    });

    onAddLog({
      source: 'Agent',
      level: 'info',
      message: `Spawning ${selectedAgent.name} (${selectedAgent.protocol ?? 'native'})`,
      detail: `Budget cap: ${selectedAgent.budget.maxTokensPerRun.toLocaleString()} tok · $${selectedAgent.budget.maxCostUsd.toFixed(2)}`,
    });

    try {
      // REAL APP: send only { agentId, task }. The server loads the
      // definition and enforces permissions. Never trust client-sent
      // systemPrompt/tools/budget.
      const res = await fetch('/api/agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: selectedAgent.name,
          systemPrompt: selectedAgent.systemPrompt,
          model: selectedAgent.model,
          tools: selectedAgent.tools,
          delegationAllowed: selectedAgent.delegation.allowed,
          maxTokensPerRun: selectedAgent.budget.maxTokensPerRun,
          task: taskInput,
          ragContext: rag.contextPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent execution failed.');

      setRunResult({
        agentName: selectedAgent.name,
        routedVia: data.routedVia,
        latencyMs: data.latencyMs,
        planSteps: data.planSteps,
        toolCallsUsed: data.toolCallsUsed,
        memoryNote: data.memoryNote,
        finalOutput: data.finalOutput,
      });

      onAddLog({
        source: 'Agent',
        level: 'success',
        message: `${selectedAgent.name} completed run in ${data.latencyMs}ms`,
        detail: `Tools: ${data.toolCallsUsed?.join(', ') || 'none'}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent run failed.';
      setRunError(msg);
      onAddLog({ source: 'Agent', level: 'error', message: msg });
    } finally {
      setRunning(false);
    }
  };

  const handleExportAgent = (agent: AgentDefinition) => {
    const blob = new Blob([JSON.stringify(agent, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.id}.agent.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = (agent: AgentDefinition) => {
    navigator.clipboard.writeText(JSON.stringify(agent, null, 2));
    setCopiedId(agent.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim()) return;
    const id = draftName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const newAgent: AgentDefinition = {
      id: `${id}-${Date.now().toString().slice(-4)}`,
      version: '1.0.0',
      name: draftName.trim(),
      description: draftDesc.trim() || 'Custom CORTEX agent preset.',
      roleTag: draftRole.trim() || 'Custom Agent',
      provider: draftProvider,
      model: draftModel,
      fallbackModels: ['gemini-3.1-flash-lite'],
      systemPrompt: draftPrompt.trim() || `You are ${draftName.trim()}, a specialist agent inside CORTEX Harness.`,
      skills: ['custom-workflow'],
      tools: draftTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      mcpServers: ['cortex-brain'],
      memory: { read: ['project', 'knowledge'], write: ['agent'] },
      delegation: { canSpawn: false, allowed: [], maxDepth: 0, maxConcurrent: 1 },
      budget: { maxTokensPerRun: 120000, maxCostUsd: 0.25 },
      permissions: { fs: 'read-only', network: false, shell: 'deny' },
      protocol: 'native',
    };
    onSaveAgent(newAgent);
    onSelectAgent(newAgent.id);
    onInspect({ kind: 'agent', agentId: newAgent.id });
    closeModal();
    setDraftName('');
    setDraftDesc('');
    setDraftPrompt('');
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setImportErrors([]);
    const parsed = parseImport(importJson);
    if (!parsed.ok) {
      setImportErrors(parsed.errors);
      return;
    }

    const conflict = detectIdConflict(parsed.agent.id, state.agents);
    const resolvedAgent: AgentDefinition = conflict.hasConflict
      ? { ...parsed.agent, id: conflict.resolvedId }
      : parsed.agent;

    const diffs = diffPermissions(null, resolvedAgent);
    const promptWarnings = flagPromptSignals(resolvedAgent.systemPrompt);

    setPendingReview({
      agent: resolvedAgent,
      diffs,
      conflict,
      promptWarnings,
    });
    setHighRiskAck(false);
    setImportStep('review');
  };

  const handleApproveImport = () => {
    if (!pendingReview) return;
    const hasHighRisk = pendingReview.diffs.some((d) => d.risk === 'high');
    if (hasHighRisk && !highRiskAck) return;

    onSaveAgent(pendingReview.agent);
    onSelectAgent(pendingReview.agent.id);
    setImportedIds((prev) => {
      const next = new Set(prev);
      next.add(pendingReview.agent.id);
      return next;
    });
    closeModal();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Agent Runtime & Fleet
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            One unified runtime driven by JSON AgentDefinitions with explicit budgets, delegation depth caps, and tool permissions.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setImportErrors([]);
              setImportStep('edit');
              setPendingReview(null);
              setHighRiskAck(false);
              setModalMode('import');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Import JSON
          </button>
          <button
            type="button"
            onClick={() => setModalMode('create')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Agent
          </button>
        </div>
      </div>

      {/* Fleet Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {state.agents.map((agent) => {
          const active = selectedAgent?.id === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onSelectAgent(agent.id);
                onInspect({ kind: 'agent', agentId: agent.id });
              }}
              className={`p-4 rounded-xl border text-left transition-colors ${
                active
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {agent.name}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(agent.id.startsWith('imported-') || importedIds.has(agent.id)) && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                      Imported
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-slate-500">
                    {agent.protocol === 'a2a' ? 'A2A' : agent.protocol === 'mcp' ? 'MCP' : 'Native'}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                {agent.roleTag}
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                {agent.description}
              </p>
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono tabular-nums text-slate-500 truncate">
                {agent.provider} · {agent.tools.length} tools · ${agent.budget.maxCostUsd.toFixed(2)} cap
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Agent Runner & Controls */}
      {selectedAgent && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-indigo-500" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Execute {selectedAgent.name}
                </h2>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Model: {selectedAgent.model} · Tools: {selectedAgent.tools.join(', ')} · Delegation:{' '}
                {selectedAgent.delegation.canSpawn
                  ? `up to ${selectedAgent.delegation.maxConcurrent} children (${selectedAgent.delegation.allowed.join(', ')})`
                  : 'leaf only'}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopyJson(selectedAgent)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                {copiedId === selectedAgent.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy JSON
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleExportAgent(selectedAgent)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export JSON
              </button>
            </div>
          </div>

          <form onSubmit={handleRunAgent} className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder={`Give ${selectedAgent.name} an objective (e.g., "Audit our RAG pipeline for project isolation edge cases")...`}
                className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={running || !taskInput.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>{running ? 'Running...' : 'Run Agent'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
                FS: {selectedAgent.permissions.fs} · Shell: {selectedAgent.permissions.shell}
              </span>
              <span className="font-mono tabular-nums">
                Max depth: {selectedAgent.delegation.maxDepth} · Max tokens:{' '}
                {selectedAgent.budget.maxTokensPerRun.toLocaleString()}
              </span>
            </div>

            {runError && (
              <div className="p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                {runError}
              </div>
            )}

            {runResult && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    Run Output · {runResult.agentName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {runResult.routedVia} · {runResult.latencyMs}ms
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Execution Trace
                    </div>
                    <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-decimal list-inside">
                      {runResult.planSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Memory Candidate
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{runResult.memoryNote}</p>
                    </div>
                    {runResult.memoryNote && (
                      <button
                        type="button"
                        onClick={() => {
                          onSaveMemoryNote(
                            `${runResult.agentName}: ${taskInput.slice(0, 48)}`,
                            runResult.memoryNote,
                            ['agent-output', selectedAgent.id]
                          );
                        }}
                        className="self-start px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-400"
                      >
                        Promote to Brain Memory
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{runResult.finalOutput}</Markdown>
                </div>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Create / Import Modal */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-label={
            modalMode === 'create'
              ? 'Create Agent Definition'
              : importStep === 'review'
                ? 'Review Agent Import'
                : 'Import Agent JSON'
          }
        >
          <div
            className={`w-full ${
              modalMode === 'import' && importStep === 'review' ? 'max-w-2xl' : 'max-w-lg'
            } max-h-[85vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {modalMode === 'create'
                  ? 'Create Agent Definition'
                  : importStep === 'review'
                    ? 'Review Agent Import'
                    : 'Import Agent JSON'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close modal"
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalMode === 'create' ? (
              <form onSubmit={handleCreateSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Agent Name
                  </label>
                  <input
                    required
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="e.g., Security Auditor"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Role Tag
                    </label>
                    <input
                      value={draftRole}
                      onChange={(e) => setDraftRole(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Model
                    </label>
                    <select
                      value={draftModel}
                      onChange={(e) => {
                        const m = AVAILABLE_MODELS.find((x) => x.id === e.target.value);
                        setDraftModel(e.target.value);
                        if (m) setDraftProvider(m.provider);
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    >
                      {AVAILABLE_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Description
                  </label>
                  <input
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                    placeholder="What does this agent specialize in?"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Tools (comma-separated)
                  </label>
                  <input
                    value={draftTools}
                    onChange={(e) => setDraftTools(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    System Prompt
                  </label>
                  <textarea
                    rows={3}
                    value={draftPrompt}
                    onChange={(e) => setDraftPrompt(e.target.value)}
                    placeholder="Define persona, constraints, and output standards..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
                  >
                    Save Agent
                  </button>
                </div>
              </form>
            ) : importStep === 'review' && pendingReview ? (
              <ImportReviewPanel
                agent={pendingReview.agent}
                diffs={pendingReview.diffs}
                conflict={pendingReview.conflict}
                promptWarnings={pendingReview.promptWarnings}
                highRiskAcknowledged={highRiskAck}
                onToggleHighRiskAck={setHighRiskAck}
                onApprove={handleApproveImport}
                onBackToEdit={handleBackToEdit}
                onReject={closeModal}
              />
            ) : (
              <form onSubmit={handleImportSubmit} className="space-y-3">
                <p className="text-xs text-slate-500">
                  Paste an AgentDefinition JSON preset (e.g.,{' '}
                  <code className="font-mono">{'{"name":"Research Agent","provider":"deepseek","model":"deepseek-v3","tools":["web","memory"]}'}</code>
                  ).
                </p>
                <textarea
                  rows={8}
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder='{"name": "Research Agent", "provider": "gemini", "model": "gemini-4-hydrogen", "tools": ["web.search", "memory.read", "wiki.read"]}'
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
                {importErrors.length > 0 && (
                  <ul className="list-disc list-inside space-y-1 text-xs text-red-500">
                    {importErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
                  >
                    Review Import
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
