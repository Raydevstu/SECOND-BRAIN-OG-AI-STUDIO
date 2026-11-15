'use client';

import React from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { AgentDefinition } from '@/lib/types';
import type { IdConflictResult, PermissionDiffItem, RiskLevel } from './importReview';

interface ImportReviewPanelProps {
  agent: AgentDefinition;
  diffs: PermissionDiffItem[];
  conflict: IdConflictResult;
  promptWarnings: string[];
  highRiskAcknowledged: boolean;
  onToggleHighRiskAck: (checked: boolean) => void;
  onApprove: () => void;
  onBackToEdit: () => void;
  onReject: () => void;
}

const RISK_BADGE_STYLES: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: 'Low',
    className:
      'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  medium: {
    label: 'Medium',
    className:
      'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  high: {
    label: 'High',
    className:
      'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
  },
};

export function ImportReviewPanel({
  agent,
  diffs,
  conflict,
  promptWarnings,
  highRiskAcknowledged,
  onToggleHighRiskAck,
  onApprove,
  onBackToEdit,
  onReject,
}: ImportReviewPanelProps) {
  const hasHighRisk = diffs.some((d) => d.risk === 'high');

  return (
    <div className="space-y-4">
      {/* Agent summary */}
      <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">{agent.name}</span>
          <span className="text-xs font-mono text-slate-500">
            {agent.provider} · {agent.model}
          </span>
        </div>
        <div className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
          {agent.roleTag}
        </div>
      </div>

      {/* ID conflict notice */}
      {conflict.hasConflict && (
        <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">ID conflict detected:</span> existing agent{' '}
            {conflict.conflictingAgentName ? `"${conflict.conflictingAgentName}" ` : ''}uses ID{' '}
            <code className="font-mono">{conflict.originalId}</code>. Importing as a new agent with
            ID <code className="font-mono">{conflict.resolvedId}</code> instead of overwriting.
          </div>
        </div>
      )}

      {/* Permission diff table */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Permission & Capability Changes (vs. safe baseline)
        </div>
        {diffs.length === 0 ? (
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
            All permissions match the safe baseline.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">To</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {diffs.map((item, index) => {
                  const badge = RISK_BADGE_STYLES[item.risk];
                  return (
                    <tr key={`${item.field}-${index}`}>
                      <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">
                        {item.field}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500 break-all">{item.from}</td>
                      <td className="px-3 py-2 font-mono text-slate-900 dark:text-slate-100 break-all">
                        {item.to}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Prompt-signal heuristic hints */}
      {promptWarnings.length > 0 && (
        <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Prompt Signal Hints (heuristic only, not a security guarantee)</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs text-amber-900 dark:text-amber-200">
            {promptWarnings.map((warning, idx) => (
              <li key={idx}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Full system prompt */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          System Prompt (read-only)
        </div>
        <pre className="max-h-36 overflow-y-auto p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
          {agent.systemPrompt}
        </pre>
      </div>

      {/* High-risk acknowledgement */}
      {hasHighRisk && (
        <label className="flex items-center gap-2 p-2.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-200 cursor-pointer">
          <input
            type="checkbox"
            checked={highRiskAcknowledged}
            onChange={(e) => onToggleHighRiskAck(e.target.checked)}
            className="rounded border-red-300"
          />
          <span>I reviewed the high-risk permissions</span>
        </label>
      )}

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onReject}
          className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onBackToEdit}
          className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Back to edit
        </button>
        <button
          type="button"
          disabled={hasHighRisk && !highRiskAcknowledged}
          onClick={onApprove}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Approve and save
        </button>
      </div>
    </div>
  );
}
