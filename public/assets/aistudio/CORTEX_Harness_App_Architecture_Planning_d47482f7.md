I wrote complete replacement files for S1–S6, based on the OBA source in your repomix pack. **I haven't compiled or run them.** Before relying on them, run `type-check`, `lint` and `npm run test` (Step 3 at the end).

S1 needed more files than I planned. Besides the port binding, two more attacks go through the same weakness:
- **A malicious website can attack your local app (CSRF).** Any website you visit can send a POST to `http://127.0.0.1:3000/api/llm-backend` from your own browser. `req.json()` reads the body whatever its content type, so this works even while the app only listens on localhost.
- **A malicious website can take over first-run setup.** `/api/auth/setup` has no guard, so a site could create the owner account before you do.

The new `checkTrustedRequest()` in `auth.ts` blocks both. S7 (the Caddyfile) isn't included.

## What changes

| Fix | Files | What changes in behaviour |
|---|---|---|
| S1 | `src/lib/auth.ts`, `src/app/api/llm-backend/route.ts`, `src/app/api/auth/setup/route.ts`, `docker-compose.yml`, `package.json` | **Network access:** dev, start and Docker all listen on localhost only. Requests are refused if the Host isn't allowed, if they come from another website, or if open mode is reached through a non-localhost address. **API key protection:** changing a provider's base URL now requires re-entering its key in the same save. Only the owner can change LLM settings. |
| S2 + S3 | `src/app/api/project-scan/route.ts` | **Scanning is off until you set `BRAIN_SCAN_ROOTS`.** Every file's contents are redacted before capture, and each scan is written to the audit log. |
| S4 | `src/app/api/auth/pin/route.ts` | The brute-force limit is now one global counter, so a spoofed `X-Forwarded-For` doesn't help. After 5 wrong PINs it locks for 15 minutes. Wrong attempts are delayed, and the PIN must be at least 6 characters. |
| S5 | `src/lib/brain/vision-ocr.ts` | Screenshots go to cloud OCR only when the active backend really is OpenAI. Text from OCR is now redacted too: before, it skipped the privacy filter. |
| S6 | `src/lib/db.ts` | Prisma no longer logs every query by default. |
| Support | `.env.example` | Documents the new variables. |

---

### 1. `src/lib/auth.ts`

```ts
// Project Brain OS — Auth Core (credential accounts, HS256 JWT httpOnly sessions,
// RBAC) + S1 network trust boundary.
//
// S1: every guarded request first passes checkTrustedRequest():
//   - Host must be loopback (localhost / 127.0.0.1 / ::1) or listed in
//     BRAIN_ALLOWED_HOSTS → blocks DNS-rebinding attacks.
//   - Browser requests from other sites (Sec-Fetch-Site: cross-site, or an
//     Origin whose hostname differs from Host) are rejected → blocks CSRF
//     against open mode, where no cookie is needed.
//   - Open (bootstrap) mode is served to loopback hosts only.
// Binding the server to 127.0.0.1 is still the primary control: a LAN client
// can forge the Host header, so these checks are defence in depth.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "brain_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days, sliding via /api/auth/refresh
const SCRYPT_KEYLEN = 64;
const JWT_SECRET_KEY = "auth_jwt_secret"; // Setting-table row; deliberately NOT in SETTING_KEYS

export type Role = "owner" | "editor" | "viewer";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- JWT (HS256, node:crypto) ----------

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

interface JwtPayload extends SessionUser {
  iat: number;
  exp: number;
}

async function jwtSecret(): Promise<Buffer> {
  const row = await db.setting.findUnique({ where: { key: JWT_SECRET_KEY } }).catch(() => null);
  if (row?.value) return Buffer.from(row.value, "hex");
  // Pre-bootstrap fallback: only verifies tokens nobody has been issued.
  return createHmac("sha256", "brain-os-dev-secret").update("jwt").digest();
}

export async function issueSessionToken(user: SessionUser): Promise<{ token: string; exp: number }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + SESSION_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload: JwtPayload = { ...user, iat: issuedAt, exp };
  const body = b64url(JSON.stringify(payload));
  const secret = await jwtSecret();
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return { token: `${header}.${body}.${sig}`, exp };
}

export async function verifySessionToken(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const secret = await jwtSecret();
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const provided = fromB64url(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.id || !payload.email || !payload.role) return null;
  return { id: payload.id, email: payload.email, name: payload.name, role: payload.role };
}

// ---------- auth state / bootstrap semantics ----------

export type AuthMode = "open" | "enforced";

export interface AuthState {
  mode: AuthMode;
  accountCount: number;
}

/** Enforced once an account exists, unless auth_mode is explicitly "open". */
export async function getAuthState(): Promise<AuthState> {
  const [accountCount, modeRow] = await Promise.all([
    db.userAccount.count().catch(() => 0),
    db.setting.findUnique({ where: { key: "auth_mode" } }).catch(() => null),
  ]);
  if (accountCount === 0) return { mode: "open", accountCount };
  const override = (modeRow?.value ?? "").trim();
  return { mode: override === "open" ? "open" : "enforced", accountCount };
}

export async function getJwtSecretForSetup(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: JWT_SECRET_KEY } }).catch(() => null);
  if (row?.value) return row.value;
  const secret = randomBytes(32).toString("hex");
  await db.setting.upsert({
    where: { key: JWT_SECRET_KEY },
    create: { key: JWT_SECRET_KEY, value: secret },
    update: { value: secret },
  });
  return secret;
}

// ---------- cookie helpers ----------

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    secure: false, // plain-HTTP localhost; httpOnly + SameSite=Lax still apply
  };
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

/** Extracts an agent ingest token from Authorization: Bearer or X-Brain-Token. */
export function readAgentToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-brain-token");
}

// ---------- S1: network trust boundary ----------

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** "127.0.0.1:3000" -> "127.0.0.1", "[::1]:3000" -> "::1", "Localhost" -> "localhost". */
function hostnameOf(rawHost: string): string {
  const value = rawHost.trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : value;
  }
  const firstColon = value.indexOf(":");
  // Exactly one colon = host:port. More than one = bare IPv6 without port.
  if (firstColon > -1 && firstColon === value.lastIndexOf(":")) return value.slice(0, firstColon);
  return value;
}

function extraAllowedHostnames(): Set<string> {
  return new Set(
    (process.env.BRAIN_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => hostnameOf(h))
      .filter(Boolean),
  );
}

export type TrustCheckResult =
  | { ok: true; loopback: boolean }
  | { ok: false; status: 403; error: string };

/**
 * Rejects requests addressed to an unexpected Host (DNS rebinding) and
 * browser requests initiated by another site (CSRF). Requests without an
 * Origin header (curl, desktop agent, MCP server, test suites) pass.
 */
export function checkTrustedRequest(req: Request): TrustCheckResult {
  const hostname = hostnameOf(req.headers.get("host") ?? "");
  const loopback = LOOPBACK_HOSTNAMES.has(hostname);
  if (!loopback && !extraAllowedHostnames().has(hostname)) {
    return {
      ok: false,
      status: 403,
      error: `Host '${hostname || "(none)"}' is not allowed. Add it to BRAIN_ALLOWED_HOSTS to serve Brain OS on that address.`,
    };
  }

  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, status: 403, error: "Cross-site requests are not allowed" };
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHostname = "";
    try {
      originHostname = origin === "null" ? "" : new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    } catch {
      originHostname = "";
    }
    if (!originHostname || originHostname !== hostname) {
      return { ok: false, status: 403, error: "Request origin does not match this Brain OS host" };
    }
  }

  return { ok: true, loopback };
}

// ---------- API guard ----------

export interface ApiGuardOptions {
  /** true => require role owner|editor (viewer gets 403). */
  mutation?: boolean;
  /** true => the desktop-agent ingest token is also accepted (capture pipeline). */
  allowAgentToken?: boolean;
}

export type ApiGuardResult =
  | { ok: true; user: SessionUser | null; mode: AuthMode; viaAgent: boolean }
  | { ok: false; status: 401 | 403; error: string };

/** Single enforcement point used by every protected route. */
export async function apiGuard(req: Request, opts: ApiGuardOptions = {}): Promise<ApiGuardResult> {
  const trust = checkTrustedRequest(req);
  if (!trust.ok) return trust;

  const state = await getAuthState();
  if (state.mode === "open") {
    // S1: credential-free mode is a localhost-only convenience.
    if (!trust.loopback) {
      return {
        ok: false,
        status: 403,
        error: "Open mode only serves localhost. Create an owner account before exposing Brain OS on another address.",
      };
    }
    return { ok: true, user: null, mode: state.mode, viaAgent: false };
  }

  const user = await verifySessionToken(readSessionCookie(req));
  if (user) {
    if (opts.mutation && user.role === "viewer") {
      return { ok: false, status: 403, error: "Your role (viewer) is read-only for this action" };
    }
    return { ok: true, user, mode: state.mode, viaAgent: false };
  }

  if (opts.allowAgentToken) {
    const { checkAgentToken } = await import("@/lib/brain/settings");
    const agent = await checkAgentToken(readAgentToken(req));
    // Only a configured AND matching token counts — trusted mode must never
    // bypass session enforcement.
    if (agent.required && agent.ok) return { ok: true, user: null, mode: state.mode, viaAgent: true };
  }

  return { ok: false, status: 401, error: "Authentication required — sign in to Project Brain OS" };
}
```

### 2. `src/app/api/llm-backend/route.ts`

```ts
// Project Brain OS — Runtime LLM Backend Configuration API
//
// GET  /api/llm-backend  -> effective backend + masked config echo
// POST /api/llm-backend  -> validate + save, invalidate bridge memos, probe
//
// S1 hardening:
//   - POST is owner-only once accounts exist.
//   - Changing a provider base URL while a key for that provider is stored
//     (settings or env) requires re-entering the key in the SAME request.
//     Otherwise the probe would send the stored key as a Bearer header to
//     whatever URL was just saved (API key exfiltration).
//   - Saving a base URL equal to the current effective value is a no-op.

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { ensureSeedDataOnce } from "@/lib/brain/seed";
import {
  CLEAR_SENTINEL,
  maskSecret,
  readSettings,
  writeSettings,
  type SettingKey,
} from "@/lib/brain/settings";
import { getDedupWindowHours } from "@/lib/brain/dedup";
import { llmBridge, PROVIDERS, type ProviderChoice } from "@/lib/brain/llm-bridge";

export const dynamic = "force-dynamic";

const SECRET_KEYS: SettingKey[] = ["openai_api_key", "anthropic_api_key", "gemini_api_key", "agent_ingest_token"];
const URL_KEYS: SettingKey[] = ["ollama_url", "openai_base_url", "anthropic_base_url", "gemini_base_url"];

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com";
const DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com";

interface BaseUrlKeyPair {
  urlKey: SettingKey;
  secretKey: SettingKey;
  envUrl: () => string;
  fallback: string;
}

/** Provider base URLs that receive an API key on every call/probe. */
const KEYED_BASE_URLS: BaseUrlKeyPair[] = [
  { urlKey: "openai_base_url", secretKey: "openai_api_key", envUrl: () => process.env.OPENAI_BASE_URL || "", fallback: DEFAULT_OPENAI_BASE },
  { urlKey: "anthropic_base_url", secretKey: "anthropic_api_key", envUrl: () => process.env.ANTHROPIC_BASE_URL || "", fallback: DEFAULT_ANTHROPIC_BASE },
  { urlKey: "gemini_base_url", secretKey: "gemini_api_key", envUrl: () => process.env.GEMINI_BASE_URL || "", fallback: DEFAULT_GEMINI_BASE },
];

const normalizeBase = (url: string) => url.trim().replace(/\/+$/, "");

function secretShape(storedValue: string, envValue: string) {
  const effective = storedValue || envValue;
  return {
    configured: Boolean(effective),
    masked: maskSecret(effective),
    source: storedValue ? "settings" : envValue ? "env" : "none",
  };
}

function envKey(k: SettingKey): string {
  switch (k) {
    case "openai_api_key": return process.env.OPENAI_API_KEY || "";
    case "anthropic_api_key": return process.env.ANTHROPIC_API_KEY || "";
    case "gemini_api_key": return process.env.GEMINI_API_KEY || "";
    case "agent_ingest_token": return process.env.BRAIN_INGEST_TOKEN || "";
    default: return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    const gate = await apiGuard(req, { mutation: false });
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureSeedDataOnce();
    const stored = await readSettings();
    const backend = await llmBridge.detectActiveBackend();
    return NextResponse.json({
      effective_backend: backend,
      config: {
        provider: stored.llm_provider || "auto",
        ollama_url: stored.ollama_url || process.env.OLLAMA_URL || "http://127.0.0.1:11434",
        ollama_model: stored.ollama_model || process.env.OLLAMA_MODEL || "llama3.2",
        openai_api_key: secretShape(stored.openai_api_key || "", envKey("openai_api_key")),
        anthropic_api_key: secretShape(stored.anthropic_api_key || "", envKey("anthropic_api_key")),
        gemini_api_key: secretShape(stored.gemini_api_key || "", envKey("gemini_api_key")),
        openai_base_url: stored.openai_base_url || process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE,
        anthropic_base_url: stored.anthropic_base_url || process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE,
        gemini_base_url: stored.gemini_base_url || process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE,
        llm_timeout_seconds: stored.llm_timeout_seconds || "",
        dedup_window_hours: await getDedupWindowHours(),
        agent_ingest_token: secretShape(stored.agent_ingest_token || "", envKey("agent_ingest_token")),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to read LLM backend config" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await apiGuard(req, { mutation: true });
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    // S1: keys and provider endpoints are owner-only once accounts exist.
    if (gate.user && gate.user.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can change LLM backend settings" }, { status: 403 });
    }
    await ensureSeedDataOnce();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // ---- validate ----
    const errors: string[] = [];
    const patch: Partial<Record<SettingKey, string>> = {};
    let generatedToken = "";

    if (body.provider !== undefined) {
      const p = String(body.provider);
      if (!PROVIDERS.includes(p as ProviderChoice)) errors.push(`provider must be one of: ${PROVIDERS.join(", ")}`);
      else patch.llm_provider = p;
    }
    if (body.dedup_window_hours !== undefined) {
      const n = Number(body.dedup_window_hours);
      if (!Number.isInteger(n) || n < 1 || n > 8760) errors.push("dedup_window_hours must be an integer between 1 and 8760");
      else patch.dedup_window_hours = String(n);
    }
    if (body.llm_timeout_seconds !== undefined) {
      const raw = String(body.llm_timeout_seconds).trim();
      if (raw === "") patch.llm_timeout_seconds = CLEAR_SENTINEL;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 3 || n > 120) errors.push("llm_timeout_seconds must be an integer between 3 and 120");
        else patch.llm_timeout_seconds = String(n);
      }
    }
    for (const key of URL_KEYS) {
      if (body[key] === undefined) continue;
      const v = String(body[key]).trim();
      if (v === "") continue; // leave unchanged
      if (v === CLEAR_SENTINEL) { patch[key] = CLEAR_SENTINEL; continue; }
      if (!/^https?:\/\//i.test(v)) errors.push(`${key} must start with http:// or https://`);
      else patch[key] = v;
    }
    for (const key of SECRET_KEYS) {
      if (body[key] === undefined) continue;
      const v = String(body[key]);
      if (v === "") continue; // leave-blank-to-keep
      if (v === CLEAR_SENTINEL) { patch[key] = CLEAR_SENTINEL; continue; }
      if (key === "agent_ingest_token" && v === "__generate__") {
        generatedToken = randomBytes(16).toString("hex");
        patch[key] = generatedToken;
        continue;
      }
      if (key !== "agent_ingest_token" && v.trim().length < 8) {
        errors.push(`${key} looks too short to be a valid key`);
        continue;
      }
      patch[key] = v.trim();
    }

    // ---- S1: a stored key may never follow a base-URL change silently ----
    const stored = await readSettings();
    for (const pair of KEYED_BASE_URLS) {
      const nextUrl = patch[pair.urlKey];
      if (nextUrl === undefined || nextUrl === CLEAR_SENTINEL) continue; // clearing reverts to the official default
      const currentUrl = normalizeBase(stored[pair.urlKey] || pair.envUrl() || pair.fallback);
      if (normalizeBase(nextUrl) === currentUrl) {
        delete patch[pair.urlKey]; // unchanged (e.g. Settings dialog re-sends current values)
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
      return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    }

    // ---- save + invalidate ----
    const savedKeys = await writeSettings(patch);
    llmBridge.invalidateRuntimeConfig();

    // ---- probe (unless explicitly disabled) ----
    let probe: Awaited<ReturnType<typeof llmBridge.probeBackend>> | null = null;
    if (body.probe === undefined || body.probe === true) {
      probe = await llmBridge.probeBackend();
    }
    const effective = await llmBridge.detectActiveBackend();

    return NextResponse.json({
      saved: savedKeys,
      probe,
      effective_backend: effective,
      generated_token: generatedToken, // shown once to the Settings dialog
      dedup_window_hours:
        patch.dedup_window_hours !== undefined ? Number(patch.dedup_window_hours) : await getDedupWindowHours(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save LLM backend config" },
      { status: 500 }
    );
  }
}
```

### 3. `src/app/api/auth/setup/route.ts`

```ts
// POST /api/auth/setup — bootstrap the FIRST account (owner), or, once an
// owner is signed in, invite additional accounts without switching sessions.
//
// S1: the endpoint is unauthenticated during bootstrap, so it applies the
// trust boundary itself. Bootstrap is localhost-only; cross-site requests are
// rejected, so a website cannot claim the owner account through your browser.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import {
  apiGuard,
  checkTrustedRequest,
  getAuthState,
  getJwtSecretForSetup,
  hashPassword,
  issueSessionToken,
  type Role,
} from "@/lib/auth";
import { writeSettings } from "@/lib/brain/settings";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["owner", "editor", "viewer"];

export async function POST(req: NextRequest) {
  try {
    const trust = checkTrustedRequest(req);
    if (!trust.ok) return NextResponse.json({ error: trust.error }, { status: trust.status });

    const state = await getAuthState();
    const bootstrap = state.accountCount === 0;
    if (bootstrap && !trust.loopback) {
      return NextResponse.json(
        { error: "The first owner account can only be created from localhost" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim() || email.split("@")[0];
    const password = String(body.password ?? "");
    const requestedRole = ROLES.includes(body.role as Role) ? (body.role as Role) : "owner";

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    let role: Role = "owner";
    if (!bootstrap) {
      // Invite flow: only a signed-in owner may mint additional accounts.
      const gate = await apiGuard(req, { mutation: true });
      if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
      if (gate.user?.role !== "owner") {
        return NextResponse.json({ error: "Only the owner can invite accounts" }, { status: 403 });
      }
      role = requestedRole;
    }

    await getJwtSecretForSetup(); // generate the HMAC secret on first bootstrap
    const account = await db.userAccount.create({
      data: {
        id: randomUUID(),
        email,
        name,
        passwordHash: hashPassword(password),
        role,
        lastLoginAt: bootstrap ? new Date() : null,
      },
    });
    if (bootstrap) {
      await writeSettings({ auth_mode: "enforced" });
    }

    const res = NextResponse.json({
      ok: true,
      invited: !bootstrap,
      user: { id: account.id, email: account.email, name: account.name, role: account.role },
    });
    if (bootstrap) {
      const { token } = await issueSessionToken({
        id: account.id,
        email: account.email,
        name: account.name,
        role: "owner",
      });
      res.cookies.set("brain_session", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 3600,
      });
    }
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Setup failed" },
      { status: 500 },
    );
  }
}
```

### 4. `docker-compose.yml`

```yaml
services:
  brain-os:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: project-brain-os
    restart: unless-stopped
    ports:
      # S1: publish on the host's loopback interface only — never on the LAN.
      - "127.0.0.1:3001:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: file:/app/db/custom.db
      PORT: "3000"
      # 0.0.0.0 applies inside the container only; the port mapping above is the boundary.
      HOSTNAME: 0.0.0.0
      # S2: project scans are confined to the read-only mounts below.
      BRAIN_SCAN_ROOTS: /projects
    volumes:
      - brain_db:/app/db
      - brain_logs:/app/logs
      - brain_vault:/app/ProjectBrainVault
      # Host paths come from a .env file next to this compose file, e.g.:
      #   CORTEX_SCAN_ROOT=D:/Projects/GLM CORTEXT ORCASTRATOR
      #   OBA_SCAN_ROOT=D:/Projects/OBA Ultimate
      - "${CORTEX_SCAN_ROOT:-./scan-roots/cortex}:/projects/cortex:ro"
      - "${OBA_SCAN_ROOT:-./scan-roots/oba}:/projects/oba:ro"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

volumes:
  brain_db:
  brain_logs:
  brain_vault:
```

### 5. `package.json`

Only `dev` and `start` changed.

```json
{
  "name": "nextjs_tailwind_shadcn_ts",
  "version": "0.3.0",
  "private": true,
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3000 2>&1 | tee dev.log",
    "build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/",
    "start": "NODE_ENV=production HOSTNAME=127.0.0.1 bun .next/standalone/server.js 2>&1 | tee server.log",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "ci": "npm run db:generate && npm run lint && npm run type-check && npm run build",
    "test:core": "node scripts/verify-blueprint.mjs && node scripts/verify-upgrade.mjs && node scripts/verify-v2.mjs && node scripts/verify-v21.mjs",
    "test:trust": "node scripts/verify-trust.mjs",
    "test:ops": "node scripts/verify-ops.mjs",
    "test:regression": "node scripts/verify-blueprint.mjs && node scripts/verify-upgrade.mjs && node scripts/verify-v2.mjs && node scripts/verify-v21.mjs && node scripts/verify-v22.mjs && node scripts/verify-enterprise.mjs && node scripts/verify-ops.mjs && node scripts/verify-realtime.mjs && node scripts/verify-v25.mjs",
    "test": "npm run test:regression && npm run test:trust",
    "db:push": "prisma db push --accept-data-loss",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:reset": "prisma migrate reset"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@hookform/resolvers": "^5.1.1",
    "@mdxeditor/editor": "^4.5.0",
    "@prisma/client": "^6.11.1",
    "@radix-ui/react-accordion": "^1.2.11",
    "@radix-ui/react-alert-dialog": "^1.1.14",
    "@radix-ui/react-aspect-ratio": "^1.1.7",
    "@radix-ui/react-avatar": "^1.1.10",
    "@radix-ui/react-checkbox": "^1.3.2",
    "@radix-ui/react-collapsible": "^1.1.11",
    "@radix-ui/react-context-menu": "^2.2.15",
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-dropdown-menu": "^2.1.15",
    "@radix-ui/react-hover-card": "^1.1.14",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-menubar": "^1.1.15",
    "@radix-ui/react-navigation-menu": "^1.2.13",
    "@radix-ui/react-popover": "^1.1.14",
    "@radix-ui/react-progress": "^1.1.7",
    "@radix-ui/react-radio-group": "^1.3.7",
    "@radix-ui/react-scroll-area": "^1.2.9",
    "@radix-ui/react-select": "^2.2.5",
    "@radix-ui/react-separator": "^1.1.7",
    "@radix-ui/react-slider": "^1.3.5",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-switch": "^1.2.5",
    "@radix-ui/react-tabs": "^1.1.12",
    "@radix-ui/react-toast": "^1.2.14",
    "@radix-ui/react-toggle": "^1.1.9",
    "@radix-ui/react-toggle-group": "^1.1.10",
    "@radix-ui/react-tooltip": "^1.2.7",
    "@reactuses/core": "^6.0.5",
    "@tanstack/react-query": "^5.82.0",
    "@tanstack/react-table": "^8.21.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "^12.23.2",
    "input-otp": "^1.4.2",
    "lucide-react": "^0.525.0",
    "next": "^16.1.1",
    "next-auth": "^4.24.11",
    "next-intl": "^4.3.4",
    "next-themes": "^0.4.6",
    "prisma": "^6.11.1",
    "react": "^19.0.0",
    "react-day-picker": "^9.8.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.60.0",
    "react-markdown": "^10.1.0",
    "react-resizable-panels": "^3.0.3",
    "react-syntax-highlighter": "^16.1.2",
    "recharts": "^2.15.4",
    "sharp": "^0.34.3",
    "socket.io-client": "^4.8.4",
    "sonner": "^2.0.6",
    "tailwind-merge": "^3.3.1",
    "tailwindcss-animate": "^1.0.7",
    "uuid": "^11.1.0",
    "vaul": "^1.1.2",
    "z-ai-web-dev-sdk": "^0.0.18",
    "zod": "^4.0.2",
    "zustand": "^5.0.6"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "bun-types": "^1.3.4",
    "eslint": "^9",
    "eslint-config-next": "^16.4.5",
    "eslint-plugin-jsx-a11y": "^6.10.2",
    "tailwindcss": "^4",
    "tw-animate-css": "^1.3.5",
    "typescript": "^5"
  }
}
```

### 6. `src/app/api/project-scan/route.ts` (S2 + S3)

```ts
// POST /api/project-scan { projectId } — explicit import of a project's text/code files.
//
// S2: the project root must resolve (after symlinks/junctions) inside one of
//     the directories listed in BRAIN_SCAN_ROOTS. Scanning is disabled when
//     the variable is unset, so a stored rootPath like "C:/Users/<you>" can
//     never be used to read arbitrary files off the machine.
// S3: every file passes through the same Privacy Guard redaction as
//     /api/capture before it reaches SQLite, the vault, or the vector index,
//     and each scan writes an audit event.

import { realpath } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { capture } from "@/lib/brain/pipeline";
import { isSafeProjectPath, scanProjectFiles } from "@/lib/brain/project-scanner";
import { sanitizeAndValidateCapture } from "@/lib/brain/privacy-redactor";
import { recordAuditEvent } from "@/lib/brain/audit";
import { getProjectById } from "@/lib/brain/store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Hard ceiling per request so one scan cannot monopolise the server. */
const MAX_FILES_PER_SCAN = 2000;
/** Mirrors the redactor's MAX_CONTENT_CHARS — longer files are stored truncated. */
const MAX_CONTENT_CHARS = 150_000;

function configuredScanRoots(): string[] {
  // Accept ";" or "," everywhere; also ":" on POSIX (Windows paths contain a drive colon).
  const separator = process.platform === "win32" ? /[;,]/ : /[;,:]/;
  return (process.env.BRAIN_SCAN_ROOTS ?? "")
    .split(separator)
    .map((p) => p.trim())
    .filter(Boolean);
}

type RootCheck = { ok: true; root: string } | { ok: false; status: 400 | 403; error: string };

async function resolveAllowedRoot(rootPath: string): Promise<RootCheck> {
  const allowed = configuredScanRoots();
  if (allowed.length === 0) {
    return {
      ok: false,
      status: 403,
      error: "Project scanning is disabled. Set BRAIN_SCAN_ROOTS to the folder(s) that contain your projects (e.g. D:/Projects) and restart.",
    };
  }
  let realRoot: string;
  try {
    realRoot = await realpath(rootPath);
  } catch {
    return { ok: false, status: 400, error: "Project root path does not exist or is not readable" };
  }
  for (const candidate of allowed) {
    let realAllowed: string;
    try {
      realAllowed = await realpath(candidate);
    } catch {
      continue; // misconfigured entry — ignore rather than widen access
    }
    if (isSafeProjectPath(realAllowed, realRoot)) return { ok: true, root: realRoot };
  }
  return { ok: false, status: 403, error: "Project root is outside BRAIN_SCAN_ROOTS" };
}

export async function POST(req: NextRequest) {
  try {
    const gate = await apiGuard(req, { mutation: true });
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const project = await getProjectById(String(body.projectId ?? ""));
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!project.rootPath) return NextResponse.json({ error: "Project has no root path" }, { status: 400 });

    const rootCheck = await resolveAllowedRoot(project.rootPath);
    if (!rootCheck.ok) {
      await recordAuditEvent({
        projectId: project.id,
        actorType: gate.user ? "user" : "system",
        actorId: gate.user?.id ?? null,
        eventType: "project.scan_rejected",
        entityType: "Project",
        entityId: project.id,
        details: { root_path: project.rootPath, reason: rootCheck.error },
      });
      return NextResponse.json({ error: rootCheck.error }, { status: rootCheck.status });
    }

    const scan = await scanProjectFiles(rootCheck.root);
    const files = scan.files.slice(0, MAX_FILES_PER_SCAN);
    const truncatedScan = scan.files.length > files.length;

    // Change detection: manifest (Setting row) + indexed metadata on existing items.
    const indexed = new Map<string, string>();
    const manifestKey = `project_scan:${project.id}`;
    const manifestRow = await db.setting.findUnique({ where: { key: manifestKey } });
    if (manifestRow) {
      try {
        for (const [relPath, hash] of Object.entries(JSON.parse(manifestRow.value) as Record<string, string>)) {
          indexed.set(relPath, hash);
        }
      } catch {
        // corrupt manifest — fall back to item metadata below
      }
    }
    const existing = await db.item.findMany({ where: { projectId: project.id }, select: { metadata: true } });
    for (const row of existing) {
      try {
        const m = JSON.parse(row.metadata) as { indexed_source_path?: string; indexed_content_hash?: string };
        if (m.indexed_source_path) indexed.set(m.indexed_source_path, m.indexed_content_hash ?? "");
      } catch {
        // ignore unparsable metadata
      }
    }

    let imported = 0;
    let unchanged = 0;
    let redactions = 0;
    let filesWithSecrets = 0;
    const skippedEmpty: string[] = [];

    for (const file of files) {
      if (indexed.get(file.relativePath) === file.hash) {
        unchanged++;
        continue;
      }

      // S3: same redaction as every other capture entrypoint.
      const privacy = sanitizeAndValidateCapture({
        rawContent: file.content,
        windowTitle: "",
        sourceApp: "Project File Scanner",
      });
      if (!privacy.sanitizedContent.trim()) {
        skippedEmpty.push(file.relativePath);
        continue;
      }
      redactions += privacy.redactionCount;
      if (privacy.redactionCount > 0) filesWithSecrets++;

      await capture({
        rawContent: privacy.sanitizedContent,
        itemType: "note",
        activeFilePath: file.absolutePath,
        sourceApp: "Project File Scanner",
        forcedProjectId: project.id,
        extraMetadata: {
          indexed_source_path: file.relativePath,
          indexed_content_hash: file.hash, // raw-file hash: change detection only
          indexed_at: new Date().toISOString(),
          provenance: "explicit-project-scan",
          content_hash: privacy.contentHash,
          privacy_redactions: privacy.redactionCount,
          ...(file.content.length > MAX_CONTENT_CHARS ? { content_truncated: true } : {}),
        },
      });
      imported++;
    }

    for (const file of files) indexed.set(file.relativePath, file.hash);
    const manifestValue = JSON.stringify(Object.fromEntries(indexed));
    await db.setting.upsert({
      where: { key: manifestKey },
      create: { key: manifestKey, value: manifestValue },
      update: { value: manifestValue },
    });

    const summary = {
      root: rootCheck.root,
      imported,
      unchanged,
      skipped: scan.skipped.length + skippedEmpty.length,
      errors: scan.errors.length,
      redactions,
      files_with_secrets: filesWithSecrets,
      truncated_scan: truncatedScan,
    };
    await recordAuditEvent({
      projectId: project.id,
      actorType: gate.user ? "user" : "system",
      actorId: gate.user?.id ?? null,
      eventType: "project.scanned",
      entityType: "Project",
      entityId: project.id,
      details: summary,
    });

    return NextResponse.json({
      projectId: project.id,
      rootPath: project.rootPath,
      ...summary,
      skippedFiles: [
        ...scan.skipped.slice(0, 100),
        ...skippedEmpty.slice(0, 20).map((p) => ({ path: p, reason: "empty after redaction" })),
      ],
      errorsDetail: scan.errors.slice(0, 100),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Project scan failed" },
      { status: 500 }
    );
  }
}
```

### 7. `src/app/api/auth/pin/route.ts` (S4)

```ts
// POST /api/auth/pin — opt-in local quick unlock (lower assurance than a passkey).
//
// S4: the previous limiter was keyed on X-Forwarded-For, which any client can
// rotate per attempt. Brain OS is a single-owner appliance, so the limiter is
// now GLOBAL: 5 failures within 15 minutes lock PIN login for 15 minutes for
// everyone. Password login is unaffected, so a lockout is never a full denial.
// Failures are also delayed, the PIN must be at least 6 characters, and
// cross-site posts are rejected.

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkTrustedRequest, issueSessionToken, SESSION_TTL_SECONDS, type Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PIN_LENGTH = 6;
const FAILURE_DELAY_MS = 400;

interface PinLimiter {
  failures: number[]; // timestamps inside the rolling window
  lockedUntil: number;
}

const limiter: PinLimiter = { failures: [], lockedUntil: 0 };

function isLocked(now: number): boolean {
  return now < limiter.lockedUntil;
}

function recordFailure(now: number): void {
  limiter.failures = limiter.failures.filter((t) => now - t < WINDOW_MS);
  limiter.failures.push(now);
  if (limiter.failures.length >= MAX_FAILURES) {
    limiter.lockedUntil = now + LOCKOUT_MS;
    limiter.failures = [];
  }
}

function resetLimiter(): void {
  limiter.failures = [];
  limiter.lockedUntil = 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isBrowserForm(req: NextRequest): boolean {
  return req.headers.get("content-type")?.includes("application/x-www-form-urlencoded") ?? false;
}

function formRedirect(result: "invalid" | "disabled" | "limited") {
  return new NextResponse(null, { status: 303, headers: { Location: `/local-pin?${result}=1` } });
}

function sameSecret(value: string, configured: string): boolean {
  const a = Buffer.from(value);
  const b = Buffer.from(configured);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const form = isBrowserForm(req);

  const trust = checkTrustedRequest(req);
  if (!trust.ok) return NextResponse.json({ error: trust.error }, { status: trust.status });

  const configuredPin = process.env.AUTH_LOCAL_PIN?.trim() ?? "";
  if (!configuredPin || configuredPin.length < MIN_PIN_LENGTH) {
    if (configuredPin) {
      console.warn(`[auth/pin] AUTH_LOCAL_PIN is shorter than ${MIN_PIN_LENGTH} characters — PIN login disabled`);
    }
    return form
      ? formRedirect("disabled")
      : NextResponse.json({ error: "Local PIN login is not enabled" }, { status: 404 });
  }

  if (isLocked(Date.now())) {
    return form
      ? formRedirect("limited")
      : NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  try {
    const body = form ? Object.fromEntries(await req.formData()) : await req.json().catch(() => ({}));
    const pin = String(body.pin ?? "");

    if (!sameSecret(pin, configuredPin)) {
      recordFailure(Date.now());
      await sleep(FAILURE_DELAY_MS);
      return form
        ? formRedirect("invalid")
        : NextResponse.json({ error: "Invalid local PIN" }, { status: 401 });
    }

    const owner = await db.userAccount.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });
    if (!owner) {
      return form
        ? formRedirect("disabled")
        : NextResponse.json({ error: "No owner account is configured" }, { status: 404 });
    }

    resetLimiter();

    const { token, exp } = await issueSessionToken({
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role as Role,
    });
    const res = form
      ? new NextResponse(null, { status: 303, headers: { Location: "/?pin-login=1" } })
      : NextResponse.json({ ok: true, expires_at: exp });
    res.cookies.set("brain_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (error) {
    console.error("Local PIN login failed", error instanceof Error ? error.message : "unknown error");
    return form
      ? formRedirect("invalid")
      : NextResponse.json({ error: "Local PIN login failed" }, { status: 500 });
  }
}
```

### 8. `src/lib/brain/vision-ocr.ts` (S5)

```ts
// Project Brain OS — Screenshot asset persistence + optional multimodal OCR.
//
// 1. The image is always persisted into the vault (Projects/<slug>/assets or Inbox/assets).
// 2. S5: cloud OCR runs ONLY when the effective LLM backend is OpenAI — i.e.
//    the user forced provider "openai", or "auto" resolved to OpenAI (no local
//    Ollama). Choosing Ollama or offline keeps screenshots on the machine even
//    when an OpenAI key is stored. BRAIN_DISABLE_CLOUD_OCR=1 disables it entirely.
// 3. OCR output is untrusted text taken from the screen, so it is redacted
//    with the same rules as typed captures before being returned.

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { llmBridge } from "./llm-bridge";
import { redactSecretsInText } from "./privacy-redactor";

export interface VisionOcrResult {
  extractedText: string;
  visualSemanticDescription: string;
  /** Mime type of the persisted asset (the asset ledger records it). */
  mimeType: string;
  detectedError?: {
    error: string;
    rootCause: string;
    suggestedFix: string;
  };
  savedAssetPath: string;
  providerUsed: string;
}

const OCR_TIMEOUT_MS = 20_000;

/** Parses "data:image/png;base64,..." (bare base64 accepted, defaults to png). */
function splitImageUri(imageBase64: string): { ext: string; raw: string } {
  const match = imageBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (match) {
    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    return { ext, raw: match[2] };
  }
  return { ext: "png", raw: imageBase64 };
}

const redact = (text: string): string => redactSecretsInText(text).text;

/** Returns cloud OCR credentials only when the user's chosen backend is OpenAI. */
async function cloudOcrTarget(): Promise<{ key: string; base: string } | null> {
  if (process.env.BRAIN_DISABLE_CLOUD_OCR === "1") return null;
  const backend = await llmBridge.detectActiveBackend();
  if (backend.provider !== "openai") return null;
  const cfg = await llmBridge.runtimeConfig();
  if (!cfg.openaiKey) return null;
  return { key: cfg.openaiKey, base: cfg.openaiBase };
}

export async function processScreenshotAndOcr(params: {
  imageBase64: string;
  projectSlug: string;
  itemId: string;
  windowTitle?: string;
  fallbackText?: string;
}): Promise<VisionOcrResult> {
  const { ext, raw } = splitImageUri(params.imageBase64);

  // 1. Persist the raw asset (relative vault path, same convention as filePath)
  const relativeDir = params.projectSlug
    ? `ProjectBrainVault/Projects/${params.projectSlug}/assets`
    : `ProjectBrainVault/Inbox/assets`;
  const absDir = path.join(process.cwd(), ...relativeDir.split("/"));
  await mkdir(absDir, { recursive: true });
  const safeItemId = params.itemId.replace(/[^a-zA-Z0-9]/g, "").slice(-12) || "cap";
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeItemId}.${ext}`;
  await writeFile(path.join(absDir, filename), Buffer.from(raw, "base64"));
  const savedAssetPath = `${relativeDir}/${filename}`;

  // 2. Multimodal OCR — only when the user's effective backend is OpenAI
  const target = await cloudOcrTarget();
  if (target) {
    const model = process.env.BRAIN_VISION_MODEL || "gpt-4o-mini";
    try {
      const resp = await fetch(`${target.base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.key}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extract all visible text/code from the screenshot as clean Markdown, provide a 1-sentence visualSemanticDescription for semantic screenshot search, and if a terminal/IDE error is visible, include detectedError {error, rootCause, suggestedFix}. Return strict JSON.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: `Active window: ${params.windowTitle || "Unknown"}` },
                { type: "image_url", image_url: { url: `data:image/${ext};base64,${raw}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
      });

      if (resp.ok) {
        const json = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}") as {
          extractedText?: string;
          visualSemanticDescription?: string;
          detectedError?: { error?: string; rootCause?: string; suggestedFix?: string };
        };
        const detected = parsed.detectedError;
        return {
          extractedText: redact(parsed.extractedText || params.fallbackText || ""),
          visualSemanticDescription: redact(
            parsed.visualSemanticDescription || `Screenshot from ${params.windowTitle || "workspace"}`
          ),
          detectedError:
            detected && detected.error
              ? {
                  error: redact(detected.error),
                  rootCause: redact(detected.rootCause ?? ""),
                  suggestedFix: redact(detected.suggestedFix ?? ""),
                }
              : undefined,
          savedAssetPath,
          mimeType: `image/${ext}`,
          providerUsed: "openai-vision",
        };
      }
    } catch {
      // Network/timeout/parse failure — fall through to the local fallback
    }
  }

  // 3. Local fallback: asset stored, text falls back to the (already redacted) capture text
  return {
    extractedText: params.fallbackText || `Screenshot captured from ${params.windowTitle || "Desktop"}`,
    visualSemanticDescription: `Visual capture of ${params.windowTitle || "application window"}`,
    savedAssetPath,
    mimeType: `image/${ext}`,
    providerUsed: "local-asset-store",
  };
}
```

### 9. `src/lib/db.ts` (S6)

```ts
import { PrismaClient, type Prisma } from "@prisma/client";

// S6: query logging wrote every captured note — including content later
// redacted at the app layer — into stdout/dev.log/server.log, and grew
// production logs without bound. Queries are now off by default; set
// BRAIN_PRISMA_LOG_QUERIES=1 temporarily when debugging SQL.
function prismaLogLevels(): Prisma.LogLevel[] {
  if (process.env.BRAIN_PRISMA_LOG_QUERIES === "1") return ["query", "warn", "error"];
  return process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"];
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLogLevels(),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

### 10. `.env.example`

```bash
# Project Brain OS — environment template (copy to .env and adjust)
# NOTE: .env is git-ignored; never commit real keys. Values here are placeholders.

# --- Required ---------------------------------------------------------------
DATABASE_URL="file:./db/custom.db"

# --- Network boundary (S1) --------------------------------------------------
# The app serves localhost only. To reach it via another hostname (reverse
# proxy, LAN name), list it here AND create an owner account first; open
# mode always refuses non-localhost hosts.
# BRAIN_ALLOWED_HOSTS="brain.home.lan"

# --- Project scanning (S2) --------------------------------------------------
# Scanning is DISABLED until this is set. Separate entries with ";".
# BRAIN_SCAN_ROOTS="D:/Projects"

# Docker only (read by docker-compose.yml for the read-only scan mounts):
# CORTEX_SCAN_ROOT="D:/Projects/GLM CORTEXT ORCASTRATOR"
# OBA_SCAN_ROOT="D:/Projects/OBA Ultimate"

# --- Optional: owner password recovery --------------------------------------
# AUTH_RECOVERY_CODE="replace-with-a-long-random-recovery-code"

# Optional local quick-unlock PIN (min 6 characters; not a WebAuthn passkey).
# AUTH_LOCAL_PIN=""

# --- Optional: LLM backends (Settings > LLM Backend overrides env) ----------
# ANTHROPIC_API_KEY=""
# ANTHROPIC_BASE_URL="https://api.anthropic.com"
# OPENAI_API_KEY=""
# OPENAI_BASE_URL="https://api.openai.com/v1"
# GEMINI_API_KEY=""
# GEMINI_BASE_URL="https://generativelanguage.googleapis.com"
# OLLAMA_URL="http://127.0.0.1:11434"
# OLLAMA_MODEL="llama3.1"
# LLM_TIMEOUT_SECONDS="20"

# --- Optional: vision OCR (S5) ----------------------------------------------
# Cloud OCR runs only when the active backend is OpenAI. Set to 1 to never
# send screenshots off the machine.
# BRAIN_DISABLE_CLOUD_OCR="1"
# BRAIN_VISION_MODEL="gpt-4o-mini"

# --- Optional: desktop-agent ingest guard -----------------------------------
# BRAIN_INGEST_TOKEN=""

# --- Optional: debugging (S6) -----------------------------------------------
# Logs every SQL query including captured content. Never leave on.
# BRAIN_PRISMA_LOG_QUERIES="1"
```

---

## Applying and checking

**Step 1. Set the new variables.** Add these lines to your `.env`:
```bash
BRAIN_SCAN_ROOTS="D:/Projects"
CORTEX_SCAN_ROOT="D:/Projects/GLM CORTEXT ORCASTRATOR"
OBA_SCAN_ROOT="D:/Projects/OBA Ultimate"
```

**Step 2. Restart.** Restart the dev server, then rebuild Docker with `docker compose up -d --build`.

**Step 3. Run the normal checks:**
```bash
npm run type-check && npm run lint && npm run test
```
All of the existing test calls should still pass, as far as I can tell from reading them. None send an `Origin` header, all use a localhost Host, and verify-v22 supplies each key in the same request as its base URL.

**Step 4. Check the new protections by hand:**
```powershell
# S1: a request that looks like it came from another website is refused (403)
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://127.0.0.1:3000/api/llm-backend -H "Origin: http://evil.example" -d "{}"

# S1: changing the base URL while a key is stored is refused (400)
curl.exe -s -X POST http://127.0.0.1:3000/api/llm-backend -H "Content-Type: application/json" -d "{\"openai_base_url\":\"http://attacker.example/v1\",\"probe\":true}"

# S1: Docker now listens on localhost only (expect 127.0.0.1:3001)
docker port project-brain-os
```

## Things that will behave differently
- **Scan Project Files fails with a clear 403 until `BRAIN_SCAN_ROOTS` is set.** This is on purpose.
- **Opening the app from your phone or another LAN machine stops working.** That now needs `BRAIN_ALLOWED_HOSTS` plus an owner account.
- **Changing a base URL in Settings now needs the key re-entered.** The error toast explains this.
- **Very large files are stored truncated.** Scanned files over 150,000 characters are cut down and flagged `content_truncated`. This matches the limit every other capture already has.

## Other issues found while writing these
1. **Your local PIN page is probably not committed to Git.** `.gitignore` contains `local-*`, which also matches `src/app/local-pin/`. That's likely why the page is missing from the pack. Add `!src/app/local-pin/` to `.gitignore`.
2. **The realtime service is exposed to your network.** `mini-services/realtime-service` listens on every interface and accepts connections from any website (`cors: "*"`). It should listen on `127.0.0.1` only, the same as S1.
3. **Old screenshot text may hold unredacted secrets.** The S5 redaction only covers new screenshots. Text read from screenshots before this fix is stored unredacted in `BrainAsset.ocrText`, and Brain OS reuses it whenever the same image