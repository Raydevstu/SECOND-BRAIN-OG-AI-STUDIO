'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Moon, RotateCcw, Shield, Sliders, Sun } from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/seed-data';
import type { CortexState, RouterSettings } from '@/lib/types';

interface SecurityStatusSnapshot {
  authMode: 'open' | 'enforced';
  accountCount: number;
  scanRootsConfigured: boolean;
  scanRootsCount: number;
  queryLoggingEnabled: boolean;
  cloudOcrDisabled: boolean;
  recentAuditEvents: Array<{ id: string; eventType: string; entityType: string; createdAt: string }>;
}

interface SettingsModuleProps {
  state: CortexState;
  onUpdateSettings: (patch: Partial<RouterSettings>) => void;
  onResetWorkspace: () => void;
}

export function SettingsModule({ state, onUpdateSettings, onResetWorkspace }: SettingsModuleProps) {
  const [newRoot, setNewRoot] = useState('');
  const [secStatus, setSecStatus] = useState<SecurityStatusSnapshot | null>(null);
  const { settings } = state;

  useEffect(() => {
    let active = true;
    fetch('/api/security-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SecurityStatusSnapshot | null) => {
        if (active && data) setSecStatus(data);
      })
      .catch(() => {
        // Ignore offline/unauthenticated status fetch
      });
    return () => {
      active = false;
    };
  }, []);

  const handleAddScanRoot = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRoot.trim();
    if (!trimmed || settings.allowedScanRoots.includes(trimmed)) return;
    onUpdateSettings({ allowedScanRoots: [...settings.allowedScanRoots, trimmed] });
    setNewRoot('');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Router & Security Settings
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure task-based model routing, privacy redaction, scan root boundaries, and workbench appearance.
          </p>
        </div>

        <button
          type="button"
          onClick={onResetWorkspace}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset Demo Workspace
        </button>
      </div>

      {/* Task-Based Model Routing */}
      <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Task-Based Provider Routing
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Librarian Tagging & Chunking
            </label>
            <select
              value={settings.librarianModel}
              onChange={(e) => onUpdateSettings({ librarianModel: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Planning & System Architecture
            </label>
            <select
              value={settings.planningModel}
              onChange={(e) => onUpdateSettings({ planningModel: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Private Notes & Local Fallback
            </label>
            <select
              value={settings.privateNotesModel}
              onChange={(e) => onUpdateSettings({ privateNotesModel: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Security & Privacy Guard */}
      <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-500" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Privacy Guard & Trust Boundary
          </h2>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
          <div className="py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Redact Secrets Before Ingestion & LLM Calls
              </div>
              <div className="text-xs text-slate-500">
                Automatically masks OpenAI keys, GitHub tokens, AWS access IDs, and private keys.
              </div>
            </div>
            <button
              type="button"
              onClick={() => onUpdateSettings({ redactSecretsOnIngest: !settings.redactSecretsOnIngest })}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                settings.redactSecretsOnIngest
                  ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500'
              }`}
            >
              {settings.redactSecretsOnIngest ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Enforce BRAIN_SCAN_ROOTS Allowlist
              </div>
              <div className="text-xs text-slate-500">
                Prevents project scanners from traversing symlinks or paths outside configured roots.
              </div>
            </div>
            <button
              type="button"
              onClick={() => onUpdateSettings({ strictScanRoots: !settings.strictScanRoots })}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                settings.strictScanRoots
                  ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500'
              }`}
            >
              {settings.strictScanRoots ? 'Enforced' : 'Permissive'}
            </button>
          </div>
        </div>

        <div className="space-y-2.5 pt-2">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Configured Scan Roots
          </div>
          <div className="space-y-1.5">
            {settings.allowedScanRoots.map((root) => (
              <div
                key={root}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              >
                <span>{root}</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      allowedScanRoots: settings.allowedScanRoots.filter((r) => r !== root),
                    })
                  }
                  className="text-slate-400 hover:text-red-500"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={handleAddScanRoot} className="flex gap-2">
            <input
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              placeholder="~/workspace/new-root"
              className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
            >
              Add Root
            </button>
          </form>
        </div>
      </section>

      {/* Runtime Hardening Posture (Phase A) */}
      <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Phase A Runtime Hardening Posture
            </h2>
          </div>
          <Link
            href="/local-pin"
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
          >
            Local PIN Unlock
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="text-slate-500">Auth Boundary</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {secStatus ? `${secStatus.authMode} (${secStatus.accountCount} accounts)` : 'Checking…'}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="text-slate-500">Scan Root Confinement</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {secStatus
                ? secStatus.scanRootsConfigured
                  ? `Active (${secStatus.scanRootsCount} root)`
                  : 'Disabled (fail-closed)'
                : 'Checking…'}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="text-slate-500">SQL Query Logging</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {secStatus ? (secStatus.queryLoggingEnabled ? 'Debug Enabled' : 'Suppressed (S6)') : 'Checking…'}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="text-slate-500">Audit Events Logged</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {secStatus ? `${secStatus.recentAuditEvents.length} recent` : 'Checking…'}
            </div>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Workbench Theme</h2>
          <p className="text-xs text-slate-500">Switch between high-contrast Slate Dark and crisp Light canvas.</p>
        </div>
        <button
          type="button"
          onClick={() => onUpdateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {settings.theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
          <span>{settings.theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}</span>
        </button>
      </section>
    </div>
  );
}
