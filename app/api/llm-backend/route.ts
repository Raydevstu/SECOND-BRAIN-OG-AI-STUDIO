import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { apiGuard, maskSecret } from '@/lib/auth';
import { deleteSetting, readAllSettings, upsertSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CLEAR_SENTINEL = '__clear__';
const PROVIDERS = ['auto', 'ollama', 'openai', 'anthropic', 'gemini', 'offline'] as const;
type ProviderChoice = (typeof PROVIDERS)[number];

const SECRET_KEYS = ['openai_api_key', 'anthropic_api_key', 'gemini_api_key', 'agent_ingest_token'] as const;
const URL_KEYS = ['ollama_url', 'openai_base_url', 'anthropic_base_url', 'gemini_base_url'] as const;

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com';
const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com';

interface BaseUrlKeyPair {
  urlKey: (typeof URL_KEYS)[number];
  secretKey: (typeof SECRET_KEYS)[number];
  envUrl: () => string;
  fallback: string;
}

const KEYED_BASE_URLS: BaseUrlKeyPair[] = [
  {
    urlKey: 'openai_base_url',
    secretKey: 'openai_api_key',
    envUrl: () => process.env.OPENAI_BASE_URL || '',
    fallback: DEFAULT_OPENAI_BASE,
  },
  {
    urlKey: 'anthropic_base_url',
    secretKey: 'anthropic_api_key',
    envUrl: () => process.env.ANTHROPIC_BASE_URL || '',
    fallback: DEFAULT_ANTHROPIC_BASE,
  },
  {
    urlKey: 'gemini_base_url',
    secretKey: 'gemini_api_key',
    envUrl: () => process.env.GEMINI_BASE_URL || '',
    fallback: DEFAULT_GEMINI_BASE,
  },
];

const normalizeBase = (url: string) => url.trim().replace(/\/+$/, '');

function envKey(k: (typeof SECRET_KEYS)[number]): string {
  switch (k) {
    case 'openai_api_key':
      return process.env.OPENAI_API_KEY || '';
    case 'anthropic_api_key':
      return process.env.ANTHROPIC_API_KEY || '';
    case 'gemini_api_key':
      return process.env.GEMINI_API_KEY || '';
    case 'agent_ingest_token':
      return process.env.BRAIN_INGEST_TOKEN || '';
  }
}

function secretShape(storedValue: string, envValue: string) {
  const effective = storedValue || envValue;
  return {
    configured: Boolean(effective),
    masked: maskSecret(effective),
    source: storedValue ? 'settings' : envValue ? 'env' : 'none',
  };
}

function detectActiveBackend(stored: Record<string, string>): string {
  const choice = (stored.llm_provider || 'auto').trim();
  if (choice !== 'auto') return choice;
  if (stored.gemini_api_key || process.env.GEMINI_API_KEY) return 'gemini';
  if (stored.openai_api_key || process.env.OPENAI_API_KEY) return 'openai';
  if (stored.anthropic_api_key || process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'offline';
}

export async function GET(req: NextRequest) {
  try {
    const gate = apiGuard(req, { mutation: false });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const stored = readAllSettings();
    const backend = detectActiveBackend(stored);

    return NextResponse.json({
      effective_backend: backend,
      config: {
        provider: stored.llm_provider || 'auto',
        ollama_url: stored.ollama_url || process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
        ollama_model: stored.ollama_model || process.env.OLLAMA_MODEL || 'llama3.2',
        openai_api_key: secretShape(stored.openai_api_key || '', envKey('openai_api_key')),
        anthropic_api_key: secretShape(stored.anthropic_api_key || '', envKey('anthropic_api_key')),
        gemini_api_key: secretShape(stored.gemini_api_key || '', envKey('gemini_api_key')),
        openai_base_url: stored.openai_base_url || process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE,
        anthropic_base_url:
          stored.anthropic_base_url || process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE,
        gemini_base_url: stored.gemini_base_url || process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE,
        llm_timeout_seconds: stored.llm_timeout_seconds || '',
        dedup_window_hours: Number(stored.dedup_window_hours || 24),
        agent_ingest_token: secretShape(stored.agent_ingest_token || '', envKey('agent_ingest_token')),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to read LLM backend config' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = apiGuard(req, { mutation: true });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    if (gate.user && gate.user.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can change LLM backend settings' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const errors: string[] = [];
    const patch: Record<string, string> = {};
    let generatedToken = '';

    if (body.provider !== undefined) {
      const p = String(body.provider);
      if (!PROVIDERS.includes(p as ProviderChoice)) {
        errors.push(`provider must be one of: ${PROVIDERS.join(', ')}`);
      } else {
        patch.llm_provider = p;
      }
    }

    if (body.dedup_window_hours !== undefined) {
      const n = Number(body.dedup_window_hours);
      if (!Number.isInteger(n) || n < 1 || n > 8760) {
        errors.push('dedup_window_hours must be an integer between 1 and 8760');
      } else {
        patch.dedup_window_hours = String(n);
      }
    }

    if (body.llm_timeout_seconds !== undefined) {
      const raw = String(body.llm_timeout_seconds).trim();
      if (raw === '') {
        patch.llm_timeout_seconds = CLEAR_SENTINEL;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 3 || n > 120) {
          errors.push('llm_timeout_seconds must be an integer between 3 and 120');
        } else {
          patch.llm_timeout_seconds = String(n);
        }
      }
    }

    for (const key of URL_KEYS) {
      if (body[key] === undefined) continue;
      const v = String(body[key]).trim();
      if (v === '') continue;
      if (v === CLEAR_SENTINEL) {
        patch[key] = CLEAR_SENTINEL;
        continue;
      }
      if (!/^https?:\/\//i.test(v)) {
        errors.push(`${key} must start with http:// or https://`);
      } else {
        patch[key] = v;
      }
    }

    for (const key of SECRET_KEYS) {
      if (body[key] === undefined) continue;
      const v = String(body[key]);
      if (v === '') continue;
      if (v === CLEAR_SENTINEL) {
        patch[key] = CLEAR_SENTINEL;
        continue;
      }
      if (key === 'agent_ingest_token' && v === '__generate__') {
        generatedToken = randomBytes(16).toString('hex');
        patch[key] = generatedToken;
        continue;
      }
      if (key !== 'agent_ingest_token' && v.trim().length < 8) {
        errors.push(`${key} looks too short to be a valid key`);
        continue;
      }
      patch[key] = v.trim();
    }

    // S1: stored key must never follow a base-URL change silently
    const stored = readAllSettings();
    for (const pair of KEYED_BASE_URLS) {
      const nextUrl = patch[pair.urlKey];
      if (nextUrl === undefined || nextUrl === CLEAR_SENTINEL) continue;
      const currentUrl = normalizeBase(stored[pair.urlKey] || pair.envUrl() || pair.fallback);
      if (normalizeBase(nextUrl) === currentUrl) {
        delete patch[pair.urlKey];
        continue;
      }
      const existingKey = stored[pair.secretKey] || envKey(pair.secretKey);
      const keyInRequest = patch[pair.secretKey];
      const keyResupplied = keyInRequest !== undefined && keyInRequest !== CLEAR_SENTINEL;
      if (existingKey && !keyResupplied) {
        errors.push(
          `Changing ${pair.urlKey} requires re-entering ${pair.secretKey} in the same save, so the stored key is never sent to a new endpoint`
        );
      }
    }

    if (errors.length) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
    }

    const savedKeys: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === CLEAR_SENTINEL) deleteSetting(k);
      else upsertSetting(k, v);
      savedKeys.push(k);
    }

    const updated = readAllSettings();
    return NextResponse.json({
      saved: savedKeys,
      probe: body.probe === false ? null : { ok: true, backend: detectActiveBackend(updated) },
      effective_backend: detectActiveBackend(updated),
      generated_token: generatedToken,
      dedup_window_hours: Number(updated.dedup_window_hours || 24),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save LLM backend config' },
      { status: 500 }
    );
  }
}
