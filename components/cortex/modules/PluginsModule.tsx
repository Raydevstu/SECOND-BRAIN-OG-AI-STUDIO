'use client';

import React, { useState } from 'react';
import { Check, Copy, Plug, Server, Terminal } from 'lucide-react';
import type { CortexState } from '@/lib/types';

interface PluginsModuleProps {
  state: CortexState;
  onTogglePlugin: (id: string) => void;
}

export function PluginsModule({ state, onTogglePlugin }: PluginsModuleProps) {
  const [copiedMcp, setCopiedMcp] = useState(false);

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        'cortex-brain': {
          command: 'npx',
          args: ['@cortex/mcp-server', '--transport', 'stdio'],
          tools: ['brain.search', 'wiki.read', 'librarian.ingest', 'project.export_instructions'],
        },
      },
    },
    null,
    2
  );

  const handleCopyMcp = () => {
    navigator.clipboard.writeText(mcpConfig);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 1500);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Plugins & MCP Server
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Connect external sources and expose Brain + LLM Wiki over Model Context Protocol to Claude Code, Codex, Hermes, and VS Code.
        </p>
      </div>

      {/* MCP Server Bridge Card */}
      <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-indigo-500" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                CORTEX MCP Server Configuration
              </h2>
              <p className="text-xs text-slate-500">
                Single sync layer for external coding agents and desktop editors.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyMcp}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {copiedMcp ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedMcp ? 'Copied MCP Config' : 'Copy MCP JSON'}
          </button>
        </div>

        <pre className="p-3.5 rounded-lg bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto border border-slate-800">
          {mcpConfig}
        </pre>
      </section>

      {/* Plugin Directory */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {plugin.category === 'Protocol' ? (
                    <Terminal className="w-4 h-4 text-indigo-500" />
                  ) : (
                    <Plug className="w-4 h-4 text-slate-400" />
                  )}
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{plugin.name}</h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500">{plugin.category}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {plugin.description}
              </p>
              <div className="mt-2.5 text-[11px] font-mono text-slate-400">
                Scopes: {plugin.scopes.join(' · ')}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span
                className={`text-xs font-medium ${
                  plugin.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
                }`}
              >
                {plugin.connected ? 'Connected' : 'Disconnected'}
              </span>
              <button
                type="button"
                onClick={() => onTogglePlugin(plugin.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  plugin.connected
                    ? 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    : 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                {plugin.connected ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
