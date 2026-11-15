'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  Bug,
  Check,
  ChevronDown,
  Code2,
  GitCompareArrows,
  LockKeyhole,
  MousePointer2,
  PanelRightClose,
  RotateCw,
  ScanEye,
  Terminal,
} from 'lucide-react';
import type { CortexState, InspectorTarget, KnowledgeTab, ModuleId } from '@/lib/types';
import { InspectorPanel } from './InspectorPanel';

type ToolTab = 'preview' | 'annotate' | 'markup' | 'debug' | 'diff' | 'inspect';

const INITIAL_MARKUP = `<main class="demo">
  <span class="eyebrow">LIVE PREVIEW</span>
  <h1>Build something thoughtful.</h1>
  <p>Edit the markup tab to update this page instantly.</p>
  <button class="action">Explore the workspace</button>
</main>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f8; color: #172033; font: 15px/1.6 system-ui, sans-serif; }
  .demo { width: min(520px, calc(100% - 40px)); padding: 48px; border: 1px solid #e5e7eb; border-radius: 18px; background: white; box-shadow: 0 20px 60px #17203312; }
  .eyebrow { color: #6266d9; font: 700 10px/1.2 ui-monospace, monospace; letter-spacing: .16em; }
  h1 { margin: 16px 0 8px; font-size: clamp(28px, 6vw, 42px); line-height: 1.1; letter-spacing: -.05em; }
  p { color: #64748b; }
  .action { margin-top: 12px; padding: 10px 16px; border: 0; border-radius: 8px; background: #5558d8; color: white; font: inherit; cursor: pointer; }
</style>`;

const TABS: { id: ToolTab; label: string; icon: typeof ScanEye }[] = [
  { id: 'preview', label: 'Preview', icon: ScanEye },
  { id: 'annotate', label: 'Annotate', icon: MousePointer2 },
  { id: 'markup', label: 'Markup', icon: Code2 },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'diff', label: 'Git diff', icon: GitCompareArrows },
  { id: 'inspect', label: 'Inspect', icon: Braces },
];

interface BrowserToolsSidebarProps {
  state: CortexState;
  target: InspectorTarget;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onSelectTarget: (target: InspectorTarget) => void;
  onNavigate: (module: ModuleId, opts?: { knowledgeTab?: KnowledgeTab; inspector?: InspectorTarget }) => void;
}

export function BrowserToolsSidebar({
  state,
  target,
  width,
  onWidthChange,
  onClose,
  onSelectTarget,
  onNavigate,
}: BrowserToolsSidebarProps) {
  const [activeTab, setActiveTab] = useState<ToolTab>('preview');
  const [markup, setMarkup] = useState(INITIAL_MARKUP);
  const [previewMarkup, setPreviewMarkup] = useState(INITIAL_MARKUP);
  const [annotating, setAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState<string[]>([]);
  const [browserLogs, setBrowserLogs] = useState<Array<{ level: string; message: string }>>([]);
  const [lastReload, setLastReload] = useState('Just now');
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [baselineMarkup, setBaselineMarkup] = useState(INITIAL_MARKUP);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const lastPreviewWindowRef = useRef<Window | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPreviewMarkup(markup);
      setLastReload(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [markup]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== lastPreviewWindowRef.current || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'cortex-annotation' && typeof event.data.label === 'string') {
        setAnnotations((current) => [...current, event.data.label].slice(-30));
        setActiveTab('annotate');
      }
      if (event.data.type === 'cortex-console' && typeof event.data.message === 'string') {
        setBrowserLogs((current) => [...current, { level: String(event.data.level ?? 'log'), message: event.data.message }].slice(-100));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (activeTab === 'preview' || activeTab === 'annotate') {
      lastPreviewWindowRef.current = previewRef.current?.contentWindow ?? lastPreviewWindowRef.current;
    }
    previewRef.current?.contentWindow?.postMessage({ type: 'cortex-annotate', enabled: annotating }, '*');
  }, [activeTab, annotating, previewMarkup, refreshKey]);

  useEffect(() => {
    if (!annotating) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAnnotating(false);
        setActiveTab('preview');
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [annotating]);

  const srcDoc = useMemo(() => {
    const bridge = `<script>
      (() => {
        const send = (type, data) => parent.postMessage({ type, ...data }, '*');
        const original = console.log.bind(console);
        ['log', 'info', 'warn', 'error'].forEach((level) => {
          const write = console[level].bind(console);
          console[level] = (...args) => { write(...args); send('cortex-console', { level, message: args.map((arg) => { try { return typeof arg === 'string' ? arg : JSON.stringify(arg); } catch { return String(arg); } }).join(' ') }); };
        });
        window.addEventListener('error', (event) => send('cortex-console', { level: 'error', message: event.message || 'Uncaught browser error' }));
        window.addEventListener('message', (event) => { if (event.data?.type === 'cortex-annotate') window.__cortexAnnotate = event.data.enabled; });
        document.addEventListener('click', (event) => {
          const el = event.target instanceof Element ? event.target : null;
          if (el?.closest('a[href]')) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (!window.__cortexAnnotate || !el) return;
          event.preventDefault(); event.stopPropagation();
          send('cortex-annotation', { label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' — ' + (el.textContent || '').trim().slice(0, 70) });
        }, true);
        document.addEventListener('submit', (event) => event.preventDefault(), true);
        original('Preview refreshed');
        send('cortex-console', { level: 'info', message: 'Preview refreshed' });
      })();
    </script>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${previewMarkup}${bridge}</body></html>`;
  }, [previewMarkup]);

  const diff = useMemo(() => {
    const before = baselineMarkup.split('\n');
    const after = markup.split('\n');
    const rows: Array<{ kind: 'same' | 'add' | 'remove'; text: string }> = [];
    const max = Math.max(before.length, after.length);
    for (let index = 0; index < max; index += 1) {
      if (before[index] === after[index]) rows.push({ kind: 'same', text: before[index] ?? '' });
      else {
        if (before[index] !== undefined) rows.push({ kind: 'remove', text: before[index] });
        if (after[index] !== undefined) rows.push({ kind: 'add', text: after[index] });
      }
    }
    return rows;
  }, [baselineMarkup, markup]);

  const handleRefresh = () => {
    setPreviewMarkup(markup);
    setRefreshKey((key) => key + 1);
    setLastReload(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  };

  const renderContent = () => {
    if (activeTab === 'preview' || activeTab === 'annotate') {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <div role="status" aria-label="Local preview only. Navigation and site search are disabled." title="Fixed local preview — no address editing, site search, or external navigation" className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
              <LockKeyhole className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="pointer-events-none select-none truncate font-mono italic" aria-disabled="true">Local preview only</span>
              <span className="sr-only">No address bar, URL editing, site search, or external navigation.</span>
            </div>
            <button type="button" onClick={handleRefresh} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Refresh preview" title="Refresh preview"><RotateCw className="h-3.5 w-3.5" /></button>
          </div>
          <div className="relative flex-1 min-h-0 bg-slate-100 p-2 dark:bg-slate-950">
            <iframe key={refreshKey} ref={(node) => { previewRef.current = node; if (node) lastPreviewWindowRef.current = node.contentWindow; }} title="Live browser preview" srcDoc={srcDoc} sandbox="allow-scripts" onLoad={() => setBrowserLogs((current) => [...current, { level: 'info', message: 'Preview frame loaded' }].slice(-100))} className="h-full w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800" />
            {annotating && <div className="pointer-events-none absolute inset-2 flex items-start justify-center"><span className="mt-3 rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">Click an element to annotate · Esc to exit</span></div>}
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Hot reload active</span>
            <span className="font-mono">Updated {lastReload}</span>
          </div>
          {activeTab === 'annotate' && <AnnotationList annotations={annotations} onClear={() => setAnnotations([])} />}
        </div>
      );
    }

    if (activeTab === 'markup') {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-[11px] dark:border-slate-800"><span className="font-mono text-slate-500">preview.html</span><span className="text-emerald-600 dark:text-emerald-400">Autosaved · hot reload</span></div>
          <textarea aria-label="Preview HTML and CSS markup" value={markup} onChange={(event) => setMarkup(event.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none bg-slate-950 p-4 font-mono text-[11px] leading-5 text-slate-200 outline-none selection:bg-indigo-500/40" />
          <div className="border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-800">Changes refresh the sandboxed preview automatically.</div>
        </div>
      );
    }

    if (activeTab === 'debug') {
      const entries = [...browserLogs.map((entry, index) => ({ ...entry, key: `browser-${index}`, time: 'Browser' })), ...state.runLogs.map((entry) => ({ level: entry.level, message: entry.message + (entry.detail ? ` — ${entry.detail}` : ''), key: entry.id, time: entry.timestamp }))];
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800"><span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><Terminal className="h-3.5 w-3.5 text-indigo-500" /> Console</span><button type="button" onClick={() => setBrowserLogs([])} className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white">Clear browser logs</button></div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px]">
            {entries.length === 0 ? <p className="px-2 py-6 text-center text-slate-500">No console output yet. Preview logs will appear here.</p> : entries.map((entry) => <div key={entry.key} className="flex gap-2 border-b border-slate-100 px-2 py-2 dark:border-slate-800/70"><span className="shrink-0 text-slate-400">{entry.time}</span><span className={entry.level === 'error' ? 'text-red-500' : entry.level === 'warn' ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}>{entry.message}</span></div>)}
          </div>
        </div>
      );
    }

    if (activeTab === 'diff') {
      const added = diff.filter((line) => line.kind === 'add').length;
      const removed = diff.filter((line) => line.kind === 'remove').length;
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-slate-200 px-3 py-3 dark:border-slate-800"><div className="flex items-center justify-between"><span className="text-xs font-semibold">Working tree</span><span className="font-mono text-[10px]"><span className="text-emerald-600">+{added}</span><span className="mx-1 text-slate-400">/</span><span className="text-red-500">−{removed}</span></span></div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">Local markup changes compared with the preview baseline. This is a browser preview diff, not a repository Git diff.</p></div>
          <div className="flex-1 overflow-auto bg-slate-950 py-2 font-mono text-[10px] leading-5">{diff.map((line, index) => <div key={`${index}-${line.kind}`} className={`flex gap-2 px-3 ${line.kind === 'add' ? 'bg-emerald-500/10 text-emerald-300' : line.kind === 'remove' ? 'bg-red-500/10 text-red-300' : 'text-slate-400'}`}><span className="w-3 shrink-0 select-none text-center">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span><span className="whitespace-pre-wrap break-all">{line.text || ' '}</span></div>)}</div>
          <button type="button" onClick={() => { setBaselineMarkup(markup); setCopied(true); if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current); copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500); }} className="m-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Check className="h-3.5 w-3.5" />{copied ? 'Baseline updated' : 'Set current as baseline'}</button>
        </div>
      );
    }

    return <InspectorPanel state={state} target={target} onClose={onClose} onSelectTarget={onSelectTarget} onNavigate={onNavigate} />;
  };

  return (
    <aside style={{ width: `min(${width}px, calc(100vw - 3rem))` }} className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 xl:shadow-none">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-500"><ScanEye className="h-3.5 w-3.5" /></span><div className="min-w-0"><div className="text-xs font-semibold">Browser tools</div><div className="text-[9px] text-slate-500">Sandboxed workspace</div></div></div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close browser tools"><PanelRightClose className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800"><label htmlFor="browser-tools-width" className="shrink-0 text-[10px] text-slate-500">Panel width</label><input id="browser-tools-width" type="range" min="320" max="640" step="16" value={width} onChange={(event) => onWidthChange(Number(event.target.value))} className="h-1 min-w-0 flex-1 accent-indigo-500" /><span className="w-9 text-right font-mono text-[10px] text-slate-500">{width}px</span><ChevronDown className="h-3 w-3 rotate-180 text-slate-400" /></div>
      <div role="tablist" aria-label="Browser tools" className="grid shrink-0 grid-cols-3 gap-1 border-b border-slate-200 p-2 dark:border-slate-800">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => { setActiveTab(id); setAnnotating(id === 'annotate'); }} className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[10px] font-medium transition-colors ${activeTab === id ? 'bg-slate-100 text-indigo-600 dark:bg-slate-800 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}</span></button>)}</div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden">{renderContent()}</div>
    </aside>
  );
}

function AnnotationList({ annotations, onClear }: { annotations: string[]; onClear: () => void }) {
  return <div className="max-h-36 shrink-0 overflow-y-auto border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"><div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">Annotations ({annotations.length})</span><button type="button" onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white">Clear</button></div>{annotations.length ? annotations.map((annotation, index) => <div key={`${annotation}-${index}`} className="border-t border-slate-100 py-1.5 font-mono text-[10px] text-slate-600 dark:border-slate-800 dark:text-slate-400">{index + 1}. {annotation}</div>) : <p className="text-[10px] text-slate-500">Select an element in the preview to add an annotation.</p>}</div>;
}
