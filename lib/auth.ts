// S1: Auth Core (scrypt credentials, HS256 JWT httpOnly sessions, RBAC)
// and Network Trust Boundary (DNS rebinding + CSRF + localhost open-mode guard).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { countUserAccounts, getSetting, upsertSetting } from '@/lib/db';

export const SESSION_COOKIE = 'brain_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const SCRYPT_KEYLEN = 64;
const JWT_SECRET_KEY = 'auth_jwt_secret';

export type Role = 'owner' | 'editor' | 'viewer';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

interface JwtPayload extends SessionUser {
  iat: number;
  exp: number;
}

function jwtSecret(): Buffer {
  const val = getSetting(JWT_SECRET_KEY);
  if (val) return Buffer.from(val, 'hex');
  return createHmac('sha256', 'brain-os-dev-secret').update('jwt').digest();
}

export function getJwtSecretForSetup(): string {
  const existing = getSetting(JWT_SECRET_KEY);
  if (existing) return existing;
  const secret = randomBytes(32).toString('hex');
  upsertSetting(JWT_SECRET_KEY, secret);
  return secret;
}

export function issueSessionToken(user: SessionUser): { token: string; exp: number } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + SESSION_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: JwtPayload = { ...user, iat: issuedAt, exp };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest());
  return { token: `${header}.${body}.${sig}`, exp };
}

export function verifySessionToken(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest();
  const provided = fromB64url(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.id || !payload.email || !payload.role) return null;
  return { id: payload.id, email: payload.email, name: payload.name, role: payload.role };
}

export type AuthMode = 'open' | 'enforced';

export interface AuthState {
  mode: AuthMode;
  accountCount: number;
}

export function getAuthState(): AuthState {
  const accountCount = countUserAccounts();
  if (accountCount === 0) return { mode: 'open', accountCount };
  const override = (getSetting('auth_mode') ?? '').trim();
  return { mode: override === 'open' ? 'open' : 'enforced', accountCount };
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

export function readAgentToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-brain-token');
}

// ---------- S1: network trust boundary ----------

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function hostnameOf(rawHost: string): string {
  const value = rawHost.trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : value;
  }
  const firstColon = value.indexOf(':');
  if (firstColon > -1 && firstColon === value.lastIndexOf(':')) return value.slice(0, firstColon);
  return value;
}

function extraAllowedHostnames(): Set<string> {
  const set = new Set(
    (process.env.BRAIN_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => hostnameOf(h))
      .filter(Boolean)
  );
  // In hosted preview outside test mode, allow the configured APP_URL host
  if (process.env.BRAIN_TEST_MODE !== '1' && process.env.APP_URL) {
    try {
      const h = new URL(process.env.APP_URL).hostname.toLowerCase();
      if (h) set.add(h);
    } catch {
      // ignore invalid APP_URL
    }
  }
  return set;
}

export type TrustCheckResult =
  | { ok: true; loopback: boolean; previewHost: boolean }
  | { ok: false; status: 403; error: string };

export function checkTrustedRequest(req: Request): TrustCheckResult {
  const hostname = hostnameOf(req.headers.get('host') ?? '');
  const loopback = LOOPBACK_HOSTNAMES.has(hostname);
  const allowedExtras = extraAllowedHostnames();

  if (!loopback && !allowedExtras.has(hostname)) {
    return {
      ok: false,
      status: 403,
      error: `Host '${hostname || '(none)'}' is not allowed. Add it to BRAIN_ALLOWED_HOSTS to serve Brain OS on that address.`,
    };
  }

  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return { ok: false, status: 403, error: 'Cross-site requests are not allowed' };
  }

  const origin = req.headers.get('origin');
  if (origin !== null) {
    let originHostname = '';
    try {
      originHostname =
        origin === 'null' ? '' : new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    } catch {
      originHostname = '';
    }
    if (!originHostname || originHostname !== hostname) {
      return { ok: false, status: 403, error: 'Request origin does not match this Brain OS host' };
    }
  }

  let previewHost = false;
  if (process.env.BRAIN_TEST_MODE !== '1' && process.env.APP_URL) {
    try {
      previewHost = new URL(process.env.APP_URL).hostname.toLowerCase() === hostname;
    } catch {
      previewHost = false;
    }
  }

  return { ok: true, loopback, previewHost };
}

export interface ApiGuardOptions {
  mutation?: boolean;
  allowAgentToken?: boolean;
}

export type ApiGuardResult =
  | { ok: true; user: SessionUser | null; mode: AuthMode; viaAgent: boolean }
  | { ok: false; status: 401 | 403; error: string };

export function apiGuard(req: Request, opts: ApiGuardOptions = {}): ApiGuardResult {
  const trust = checkTrustedRequest(req);
  if (!trust.ok) return trust;

  const state = getAuthState();
  if (state.mode === 'open') {
    if (!trust.loopback && !trust.previewHost) {
      return {
        ok: false,
        status: 403,
        error:
          'Open mode only serves localhost. Create an owner account before exposing Brain OS on another address.',
      };
    }
    return { ok: true, user: null, mode: state.mode, viaAgent: false };
  }

  const user = verifySessionToken(readSessionCookie(req));
  if (user) {
    if (opts.mutation && user.role === 'viewer') {
      return { ok: false, status: 403, error: 'Your role (viewer) is read-only for this action' };
    }
    return { ok: true, user, mode: state.mode, viaAgent: false };
  }

  if (opts.allowAgentToken) {
    const configuredToken = getSetting('agent_ingest_token') || process.env.BRAIN_INGEST_TOKEN || '';
    const provided = readAgentToken(req) || '';
    if (configuredToken && provided && configuredToken === provided) {
      return { ok: true, user: null, mode: state.mode, viaAgent: true };
    }
  }

  return { ok: false, status: 401, error: 'Authentication required — sign in to Project Brain OS' };
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
