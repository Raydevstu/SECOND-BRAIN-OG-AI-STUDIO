'use client';

import React, { useState } from 'react';
import { ArrowRight, Clock, Play, Plus, Workflow, X } from 'lucide-react';
import type { CortexState, InspectorTarget, RunLogEntry, WorkflowDef } from '@/lib/types';

interface WorkflowsModuleProps {
  state: CortexState;
  onToggleWorkflow: (id: string) => void;
  onRunWorkflow: (id: string) => void;
  onCreateWorkflow: (wf: WorkflowDef) => void;
  onAddLog: (entry: Omit<RunLogEntry, 'id' | 'timestamp'>) => void;
  onInspect: (target: InspectorTarget) => void;
}

export function WorkflowsModule({
  state,
  onToggleWorkflow,
  onRunWorkflow,
  onCreateWorkflow,
  onAddLog,
  onInspect,
}: WorkflowsModuleProps) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [triggerType, setTriggerType] = useState<WorkflowDef['triggerType']>('cron');
  const [schedule, setSchedule] = useState('0 9 * * *');

  const handleExecute = (wf: WorkflowDef) => {
    setRunningId(wf.id);
    onInspect({ kind: 'workflow', workflowId: wf.id });
    onAddLog({
      source: 'Workflow',
      level: 'info',
      message: `Triggered "${wf.name}" (${wf.steps.length} steps)`,
    });
    setTimeout(() => {
      onRunWorkflow(wf.id);
      onAddLog({
        source: 'Workflow',
        level: 'success',
        message: `Completed "${wf.name}"`,
        detail: wf.steps.map((s) => s.label).join(' -> '),
      });
      setRunningId(null);
    }, 550);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const newWf: WorkflowDef = {
      id: `wf-${Date.now()}`,
      name: name.trim(),
      description: desc.trim() || 'Automated CORTEX pipeline.',
      triggerType,
      schedule: triggerType === 'cron' ? schedule : undefined,
      enabled: true,
      projectId: null,
      runCount: 0,
      steps: [
        { id: `s-${Date.now()}-1`, kind: 'Trigger', label: `${triggerType} Trigger`, configSummary: schedule || 'Event hook' },
        { id: `s-${Date.now()}-2`, kind: 'Librarian', label: 'Redact & Summarize', configSummary: 'Privacy Guard + Librarian' },
        { id: `s-${Date.now()}-3`, kind: 'Memory', label: 'Store in Brain + Graph', configSummary: 'Auto-link entities' },
      ],
    };
    onCreateWorkflow(newWf);
    onInspect({ kind: 'workflow', workflowId: newWf.id });
    setShowCreate(false);
    setName('');
    setDesc('');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Workflow Engine
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Event-driven and cron-scheduled pipelines connecting Triggers, Librarian ingestion, Agents, and Memory writes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          New Workflow
        </button>
      </div>

      <div className="space-y-4">
        {state.workflows.map((wf) => (
          <div
            key={wf.id}
            onClick={() => onInspect({ kind: 'workflow', workflowId: wf.id })}
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">{wf.name}</h2>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{wf.description}</p>
                <div className="mt-1.5 flex items-center gap-3 text-xs font-mono tabular-nums text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {wf.triggerType}
                    {wf.schedule ? ` (${wf.schedule})` : ''}
                  </span>
                  <span>·</span>
                  <span>{wf.runCount} runs</span>
                  <span>·</span>
                  <span>{wf.enabled ? 'Enabled' : 'Paused'}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onToggleWorkflow(wf.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    wf.enabled
                      ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40'
                      : 'border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  {wf.enabled ? 'Active' : 'Paused'}
                </button>
                <button
                  type="button"
                  onClick={() => handleExecute(wf)}
                  disabled={runningId === wf.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  {runningId === wf.id ? 'Running...' : 'Run Now'}
                </button>
              </div>
            </div>

            {/* Visual Step Pipeline */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {wf.steps.map((step, idx) => (
                <React.Fragment key={step.id}>
                  <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 min-w-[150px]">
                    <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">{step.kind}</div>
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100">{step.label}</div>
                    <div className="text-[11px] text-slate-500 truncate">{step.configSummary}</div>
                  </div>
                  {idx < wf.steps.length - 1 && <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">New Workflow</h3>
              <button type="button" onClick={() => setShowCreate(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Workflow Name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Weekly YouTube Research Digest"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Trigger</label>
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as WorkflowDef['triggerType'])}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="cron">Cron Schedule</option>
                    <option value="file-drop">File Drop</option>
                    <option value="webhook">Webhook</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Cron / Rule</label>
                  <input
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    disabled={triggerType !== 'cron'}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 disabled:opacity-50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea
                  rows={2}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white">
                  Save Workflow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
