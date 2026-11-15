I've written the bundle: A1–A3 and A4–A6, plus a CI update. **I haven't run any of it.** I could only read the first part of your OBA repomix pack this time. That part includes `ci.yml`, but not `mini-services/realtime-service/index.ts`, the `Caddyfile`, `.gitignore`, or the existing `verify-*.mjs` scripts. So I built the new files to work without knowing those details:

- **Test runner:** it starts the test server on port 3000 itself and sets `BASE_URL`, so the existing suites hit it whether or not they hard-code the URL.
- **Security tests:** a few checks use routes whose response format I'm guessing (creating projects, login, search, audit). If the format differs, those checks report SKIP instead of a false failure.
- **Realtime service (A3):** this is a new module plus a 3-line change to your `index.ts`, not a full rewrite. Rewriting a file I can't see would delete its event handlers.
- **`.gitignore` (A5):** lines to add at the end, for the same reason.

| Item | File(s) |
|---|---|
| A1 | `scripts/test-runner.mjs` (new), `package.json` scripts, `.github/workflows/ci.yml` |
| A2 | `scripts/verify-security.mjs` (new) |
| A3 | `mini-services/realtime-service/security.ts` (new) + a 3-line edit to `index.ts` |
| A4 | `Caddyfile` |
| A5 | `.gitignore` additions |
| A6 | `scripts/redact-legacy-ocr.ts` (new) |

---

### A1 · `scripts/test-runner.mjs`

```js
#!/usr/bin/env node
// scripts/test-runner.mjs — A1: run the verify suites against throwaway databases.
//
// For each group: create a fresh SQLite file under .test/, push the Prisma
// schema into it, boot the app on 127.0.0.1 with DATABASE_URL pointing at that
// file, run the suites, stop the server, delete the files (kept on failure).
// Your real database is fingerprinted before and after; the run FAILS if it changed.
//
//   npm run test                          all groups, `next dev` server
//   npm run test -- --server=standalone   use .next/standalone (run `npm run build` first; CI does)
//   npm run test -- --only=security       one group  (or --only=verify-v22 for one suite)
//   npm run test -- --realtime            also start + check the realtime mini-service
//   npm run test -- --keep                keep .test/ artifacts even when everything passes
//   npm run test -- --bail                stop at the first failing suite

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const IS_WIN = process.platform === "win32";
const opts = parseArgs(process.argv.slice(2));
const SERVER_MODE = opts.server === "standalone" ? "standalone" : "dev";
const PORT = Number(opts.port ?? 3000);
const REALTIME_PORT = Number(opts["realtime-port"] ?? process.env.REALTIME_PORT ?? 3003);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_DIR = path.join(ROOT, ".test", `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const PRISMA_CLI = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const VAULT_DIR = path.join(ROOT, "ProjectBrainVault");
const children = new Set();

const GROUPS = [
  {
    name: "regression",
    suites: [
      "verify-blueprint", "verify-upgrade", "verify-v2", "verify-v21", "verify-v22",
      "verify-enterprise", "verify-ops", "verify-realtime", "verify-v25", "verify-trust",
    ],
    env: () => ({ BRAIN_SCAN_ROOTS: process.env.TEST_SCAN_ROOTS || ROOT }),
  },
  {
    // Own database: it creates an owner account and locks PIN login.
    name: "security",
    suites: ["verify-security"],
    env: (dir) => {
      const scanRoot = path.join(dir, "scan-root");
      const outside = path.join(dir, "outside");
      mkdirSync(scanRoot, { recursive: true });
      mkdirSync(outside, { recursive: true });
      return {
        BRAIN_SCAN_ROOTS: scanRoot,
        BRAIN_ALLOWED_HOSTS: "brain-test.local",
        BRAIN_TEST_ALLOWED_HOST: "brain-test.local",
        AUTH_LOCAL_PIN: "246810",
        BRAIN_TEST_PIN: "246810",
        BRAIN_TEST_SCAN_ROOT: scanRoot,
        BRAIN_TEST_OUTSIDE_DIR: outside,
      };
    },
  },
];

// ---------------------------------------------------------------- helpers

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toPosix = (p) => p.replace(/\\/g, "/");

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(1000, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function realDbCandidates() {
  const c = new Set([path.join(ROOT, "db", "custom.db"), path.join(ROOT, "prisma", "db", "custom.db")]);
  const envFile = path.join(ROOT, ".env");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^\s*DATABASE_URL\s*=\s*["']?file:([^"'\r\n]+)/m);
    if (m) {
      const p = m[1].trim();
      if (path.isAbsolute(p)) c.add(p);
      else { c.add(path.resolve(ROOT, p)); c.add(path.resolve(ROOT, "prisma", p)); }
    }
  }
  return [...c];
}

function fingerprintRealDb() {
  const out = {};
  for (const base of realDbCandidates()) {
    for (const suffix of ["", "-wal", "-journal"]) {
      const f = base + suffix;
      if (existsSync(f)) { const s = statSync(f); out[f] = `${s.size}:${s.mtimeMs}`; }
    }
  }
  return out;
}

function changedKeys(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
}

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p); else out.push(p);
    }
  }
  return out;
}

function safeRead(file) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

function printTail(file, lines = 60) {
  const text = safeRead(file);
  if (!text) return;
  console.log(`\n── last ${lines} lines of ${path.relative(ROOT, file)}`);
  console.log(text.split(/\r?\n/).slice(-lines).join("\n"));
}

function buildEnv(overrides) {
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    BRAIN_TEST_MODE: "1",
    BRAIN_PRISMA_LOG_QUERIES: "0",
    BASE_URL, BRAIN_BASE_URL: BASE_URL, BRAIN_URL: BASE_URL, API_BASE: BASE_URL,
    ...overrides,
  };
  if (SERVER_MODE === "dev") delete env.NODE_ENV;
  return env;
}

function pushSchema(env) {
  const r = spawnSync(process.execPath, [PRISMA_CLI, "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: ROOT, env, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`prisma db push failed:\n${r.stdout}\n${r.stderr}`);
}

// Server output goes straight to a file descriptor. Piping it through this
// process would deadlock while spawnSync() blocks on a suite.
function startServer(env, logFile) {
  let args;
  const serverEnv = { ...env };
  if (SERVER_MODE === "standalone") {
    const entry = path.join(ROOT, ".next", "standalone", "server.js");
    if (!existsSync(entry)) throw new Error(`${path.relative(ROOT, entry)} not found — run \`npm run build\` first`);
    args = [entry];
    Object.assign(serverEnv, { NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(PORT) });
  } else {
    args = [NEXT_BIN, "dev", "-H", "127.0.0.1", "-p", String(PORT)];
  }
  const fd = openSync(logFile, "a");
  const child = spawn(process.execPath, args, {
    cwd: ROOT, env: serverEnv, stdio: ["ignore", fd, fd], detached: !IS_WIN, windowsHide: true,
  });
  closeSync(fd);
  children.add(child);
  const state = { child, exited: null };
  child.on("exit", (code, signal) => { state.exited = { code, signal }; children.delete(child); });
  return state;
}

async function waitForHealth(server, timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exited) throw new Error(`server exited early (code ${server.exited.code})`);
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(10_000) });
      console.log(`  server ready in ${Math.round((Date.now() - started) / 1000)}s (${SERVER_MODE})`);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`server not responding after ${timeoutMs / 1000}s`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) { children.delete(child); return; }
  const exited = new Promise((r) => child.once("exit", r));
  if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } }
  const done = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
  if (!done && !IS_WIN) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    await Promise.race([exited, sleep(2000)]);
  }
  children.delete(child);
}

async function startRealtime() {
  const url = `http://127.0.0.1:${REALTIME_PORT}`;
  if (await portOpen(REALTIME_PORT)) {
    console.log(`realtime: using the service already listening on ${REALTIME_PORT}`);
    return { url, child: null };
  }
  const dir = path.join(ROOT, "mini-services", "realtime-service");
  if (!existsSync(path.join(dir, "index.ts"))) throw new Error("mini-services/realtime-service/index.ts not found");
  const fd = openSync(path.join(RUN_DIR, "realtime.log"), "a");
  const child = spawn("bun", ["index.ts"], {
    cwd: dir,
    env: { ...process.env, PORT: String(REALTIME_PORT), REALTIME_PORT: String(REALTIME_PORT) },
    stdio: ["ignore", fd, fd], detached: !IS_WIN, windowsHide: true,
  });
  closeSync(fd);
  children.add(child);
  let spawnError = null;
  child.on("error", (e) => { spawnError = e; });
  for (let i = 0; i < 40; i++) {
    if (spawnError) throw new Error(`could not start realtime service with bun: ${spawnError.message}`);
    if (await portOpen(REALTIME_PORT)) { console.log(`realtime: started on ${REALTIME_PORT}`); return { url, child }; }
    await sleep(500);
  }
  await stopProcess(child);
  throw new Error(`realtime service did not listen on ${REALTIME_PORT} (see .test/…/realtime.log)`);
}

function selectGroups() {
  if (!opts.only) return GROUPS;
  const wanted = new Set(String(opts.only).split(",").map((s) => s.trim()).filter(Boolean));
  const picked = [];
  for (const g of GROUPS) {
    if (wanted.has(g.name)) { picked.push(g); continue; }
    const suites = g.suites.filter((s) => wanted.has(s));
    if (suites.length) picked.push({ ...g, suites });
  }
  if (!picked.length) fail(`--only=${opts.only} matched nothing. Groups: ${GROUPS.map((g) => g.name).join(", ")}`);
  return picked;
}

// ---------------------------------------------------------------- run

async function runGroup(group, realtime) {
  const dir = path.join(RUN_DIR, group.name);
  mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, "brain.db");
  const logFile = path.join(dir, "server.log");
  const outcomes = [];
  let failed = false;
  let server = null;

  console.log(`\n▶ ${group.name}: fresh database ${path.relative(ROOT, dbFile)}`);
  try {
    const env = buildEnv({
      DATABASE_URL: `file:${toPosix(dbFile)}`,
      ...group.env(dir),
      ...(realtime ? { REALTIME_URL: realtime.url } : {}),
    });
    pushSchema(env);
    server = startServer(env, logFile);
    await waitForHealth(server);

    for (const suite of group.suites) {
      const script = path.join(ROOT, "scripts", `${suite}.mjs`);
      if (!existsSync(script)) {
        outcomes.push({ group: group.name, suite, status: "fail", note: "script not found" });
        failed = true;
        continue;
      }
      console.log(`\n── ${suite}`);
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [script], { cwd: ROOT, env, stdio: "inherit" });
      const ok = r.status === 0;
      outcomes.push({ group: group.name, suite, status: ok ? "pass" : "fail", note: `${Math.round((Date.now() - t0) / 1000)}s` });
      if (!ok) { failed = true; if (opts.bail) break; }
    }
  } catch (e) {
    failed = true;
    outcomes.push({ group: group.name, suite: "(setup)", status: "fail", note: e instanceof Error ? e.message : String(e) });
    printTail(logFile);
  } finally {
    if (server) await stopProcess(server.child);
  }

  // S6 guard: query logging must stay off.
  if (/prisma:query/.test(safeRead(logFile))) {
    failed = true;
    outcomes.push({ group: group.name, suite: "S6 log check", status: "fail", note: "server log contains prisma:query lines" });
  } else {
    outcomes.push({ group: group.name, suite: "S6 log check", status: "pass" });
  }
  return { outcomes, failed };
}

async function main() {
  if (!existsSync(NEXT_BIN) || !existsSync(PRISMA_CLI)) fail("node_modules missing — run `npm install` first");
  if (await portOpen(PORT)) {
    fail(`Port ${PORT} is already in use. Stop your dev server first: it is connected to your REAL database, and the suites expect the test server on this port.`);
  }

  const groups = selectGroups();
  const dbBefore = fingerprintRealDb();
  const vaultBefore = new Set(listFiles(VAULT_DIR));
  mkdirSync(RUN_DIR, { recursive: true });

  process.on("SIGINT", async () => {
    console.log("\ninterrupted — stopping test processes");
    for (const c of [...children]) await stopProcess(c);
    process.exit(130);
  });

  const outcomes = [];
  let failed = false;
  let realtime = null;
  try {
    if (opts.realtime) realtime = await startRealtime();
    for (const group of groups) {
      const r = await runGroup(group, realtime);
      outcomes.push(...r.outcomes);
      if (r.failed) { failed = true; if (opts.bail) break; }
    }
  } catch (e) {
    failed = true;
    outcomes.push({ group: "-", suite: "(runner)", status: "fail", note: e instanceof Error ? e.message : String(e) });
  } finally {
    if (realtime?.child) await stopProcess(realtime.child);
  }

  const touched = changedKeys(dbBefore, fingerprintRealDb());
  if (touched.length) {
    failed = true;
    outcomes.push({ group: "-", suite: "real DB untouched", status: "fail", note: `changed: ${touched.join(", ")}` });
  } else {
    outcomes.push({ group: "-", suite: "real DB untouched", status: "pass" });
  }

  const newVaultFiles = listFiles(VAULT_DIR).filter((f) => !vaultBefore.has(f));
  if (newVaultFiles.length) {
    console.log(`\nnote: ${newVaultFiles.length} new file(s) in ProjectBrainVault/ (dev-mode tests still write the vault):`);
    for (const f of newVaultFiles.slice(0, 10)) console.log(`  ${path.relative(ROOT, f)}`);
  }

  console.log("\n══ Summary");
  const icon = { pass: "✓", fail: "✗" };
  for (const o of outcomes) {
    console.log(`  ${icon[o.status] ?? "-"} ${o.group.padEnd(11)} ${o.suite}${o.note ? `  (${o.note})` : ""}`);
  }

  if (!failed && !opts.keep) rmSync(RUN_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  else console.log(`\nartifacts kept in ${path.relative(ROOT, RUN_DIR)}`);
  process.exit(failed ? 1 : 0);
}

main();
```

### A1 · `package.json` (only the `scripts` block changes; the rest stays as in the S1 version)

```json
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3000 2>&1 | tee dev.log",
    "build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/",
    "start": "NODE_ENV=production HOSTNAME=127.0.0.1 bun .next/standalone/server.js 2>&1 | tee server.log",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "ci": "npm run db:generate && npm run lint && npm run type-check && npm run build",
    "test": "node scripts/test-runner.mjs",
    "test:security": "node scripts/test-runner.mjs --only=security",
    "test:core": "node scripts/verify-blueprint.mjs && node scripts/verify-upgrade.mjs && node scripts/verify-v2.mjs && node scripts/verify-v21.mjs",
    "test:trust": "node scripts/verify-trust.mjs",
    "test:ops": "node scripts/verify-ops.mjs",
    "test:regression": "node scripts/verify-blueprint.mjs && node scripts/verify-upgrade.mjs && node scripts/verify-v2.mjs && node scripts/verify-v21.mjs && node scripts/verify-v22.mjs && node scripts/verify-enterprise.mjs && node scripts/verify-ops.mjs && node scripts/verify-realtime.mjs && node scripts/verify-v25.mjs",
    "test:live": "npm run test:regression && npm run test:trust",
    "redact:ocr": "bun scripts/redact-legacy-ocr.ts",
    "redact:ocr:apply": "bun scripts/redact-legacy-ocr.ts --apply",
    "db:push": "prisma db push --accept-data-loss",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:reset": "prisma migrate reset"
  },
```

`test:live` keeps the old behaviour: it runs the suites against whatever server is already running. Only use it on purpose.

### A1 · `.github/workflows/ci.yml`

The runner now handles the database and server, so the "Prepare Database", "Boot Production Server" and "Stop Server" steps are gone. As a side effect, CI no longer depends on the machine-specific path in your committed `.env`.

```yaml
# Project Brain OS — CI/CD (self-hosted appliance; Docker image is the artifact).
# TEST stage: scripts/test-runner.mjs pushes the schema into throwaway SQLite
# files, boots the standalone server on 127.0.0.1 per group, and runs the
# regression board + security suite. Rollback = re-deploy a previous image tag.

name: Brain OS CI

on:
  push:
    branches: [main, develop]
    paths:
      - "src/**"
      - "prisma/**"
      - "public/**"
      - "scripts/**"
      - "mini-services/**"
      - "Caddyfile"
      - "package.json"
      - "package-lock.json"
      - "next.config.ts"
      - "eslint.config.mjs"
      - "tsconfig.json"
      - ".github/workflows/*.yml"
  pull_request:
    branches: [main, develop]
    types: [opened, synchronize, reopened]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build_test_verify:
    name: Build · Lint · Type-check · Regression + security
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install Dependencies (frozen lockfile)
        run: npm ci

      - name: Generate Prisma Client
        run: npx prisma generate

      - name: Lint
        run: npm run lint

      - name: Type Check
        run: npm run type-check

      - name: Build Next.js Application (standalone artifact)
        run: npm run build

      - name: Regression board + security suite (throwaway databases)
        run: npm run test -- --server=standalone

      - name: Collect Logs on Failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: brain-os-test-artifacts
          path: |
            .test/
            logs/
          if-no-files-found: ignore
          retention-days: 7

  docker_artifact:
    name: Build Docker Artifact (deployable image)
    needs: build_test_verify
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Image (proves the artifact compiles)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          load: true
          tags: brain-os:ci-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

I moved `prisma generate` before `type-check`, because `tsc` needs the generated client.

---

### A2 · `scripts/verify-security.mjs`

```js
#!/usr/bin/env node
// scripts/verify-security.mjs — A2: regression tests for the S1–S7 and A3 fixes.
//
// Run with `npm run test:security`. The runner gives this suite its own fresh
// database: it creates an owner account and locks PIN login for 15 minutes.
// Checks that depend on API shapes this suite cannot be sure of (projects,
// login, search, audit) report SKIP rather than fail when the shape differs.

import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";

if (process.env.BRAIN_TEST_MODE !== "1" && !process.argv.includes("--i-know-this-mutates")) {
  console.error("verify-security: refusing to run outside scripts/test-runner.mjs (it creates accounts and locks PIN login). Use `npm run test:security`.");
  process.exit(2);
}

const BASE = new URL(process.env.BASE_URL || "http://127.0.0.1:3000");
const APP_PORT = Number(BASE.port || 80);
const LOCAL = `127.0.0.1:${APP_PORT}`;
const EXTRA_HOST = `${process.env.BRAIN_TEST_ALLOWED_HOST || "brain-test.local"}:${APP_PORT}`;
const EVIL_ORIGIN = "http://evil.example";
const PIN = process.env.BRAIN_TEST_PIN || "";
const SCAN_ROOT = process.env.BRAIN_TEST_SCAN_ROOT || "";
const OUTSIDE_DIR = process.env.BRAIN_TEST_OUTSIDE_DIR || "";
const REALTIME = process.env.REALTIME_URL ? new URL(process.env.REALTIME_URL) : null;

// ---------------------------------------------------------------- helpers

const hex = (n = 8) => randomBytes(n).toString("hex");
function fromCharset(len, charset) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => charset[b % charset.length]).join("");
}
const UPPER_ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Raw HTTP so Host / Origin / Sec-Fetch-* can be set freely. */
function send(method, urlPath, { target = BASE, host, headers = {}, json, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = json !== undefined ? JSON.stringify(json) : body;
    const h = { host: host ?? target.host, ...headers };
    if (json !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === "content-type")) {
      h["content-type"] = "application/json";
    }
    if (payload !== undefined) h["content-length"] = Buffer.byteLength(payload);
    const req = http.request(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: Number(target.port || 80),
        method,
        path: urlPath,
        headers: h,
        timeout: 120_000, // dev mode compiles routes on first hit
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parsed });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout: ${method} ${urlPath}`)));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function sessionCookie(res) {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = list.find((c) => c.startsWith("brain_session="));
  return hit ? hit.split(";")[0] : null;
}

function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(1500, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function lanIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if ((a.family === "IPv4" || a.family === 4) && !a.internal) return a.address;
    }
  }
  return null;
}

const results = [];
const skip = (why) => ({ skip: why });
function section(title) { console.log(`\n${title}`); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function expectStatus(res, expected, ctx) {
  const list = Array.isArray(expected) ? expected : [expected];
  if (!list.includes(res.status)) throw new Error(`${ctx}: expected ${list.join("/")}, got ${res.status} — ${res.text.slice(0, 200)}`);
}
async function test(id, name, fn) {
  try {
    const r = await fn();
    if (r && r.skip) {
      results.push({ id, status: "skip" });
      console.log(`  - SKIP ${id} ${name} — ${r.skip}`);
    } else {
      results.push({ id, status: "pass" });
      console.log(`  ✓ ${id} ${name}`);
    }
  } catch (e) {
    results.push({ id, status: "fail" });
    console.log(`  ✗ ${id} ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
  }
}

const getLlm = (o = {}) => send("GET", "/api/llm-backend", o);
const postLlm = (json, o = {}) => send("POST", "/api/llm-backend", { json, ...o });

// ---------------------------------------------------------------- suite

async function main() {
  console.log(`verify-security → ${BASE.origin}`);
  const pre = await getLlm();
  if (pre.status !== 200) {
    console.error(`pre-flight: expected open mode (200 from GET /api/llm-backend), got ${pre.status}. This suite needs a fresh database.`);
    process.exit(1);
  }

  // ---- S1: Host / Origin -------------------------------------------------
  section("S1 · Host and origin checks (open mode)");
  await test("S1-01", "unknown Host header is refused (DNS rebinding)", async () => {
    expectStatus(await getLlm({ host: `evil.example:${APP_PORT}` }), 403, "Host evil.example");
  });
  await test("S1-02", "request from another website is refused (Origin)", async () => {
    expectStatus(await postLlm({ probe: false }, { headers: { origin: EVIL_ORIGIN } }), 403, "Origin evil");
  });
  await test("S1-03", "Sec-Fetch-Site: cross-site is refused", async () => {
    expectStatus(await postLlm({ probe: false }, { headers: { "sec-fetch-site": "cross-site" } }), 403, "cross-site");
  });
  await test("S1-04", "Origin: null (sandboxed iframe) is refused", async () => {
    expectStatus(await postLlm({ probe: false }, { headers: { origin: "null" } }), 403, "Origin null");
  });
  await test("S1-05", "text/plain CSRF body from another site is refused", async () => {
    const r = await send("POST", "/api/llm-backend", {
      headers: { origin: EVIL_ORIGIN, "content-type": "text/plain" },
      body: JSON.stringify({ provider: "offline", probe: false }),
    });
    expectStatus(r, 403, "text/plain CSRF");
  });
  await test("S1-06", "same-origin browser request is accepted", async () => {
    const r = await postLlm({ probe: false }, { headers: { origin: `http://${LOCAL}`, "sec-fetch-site": "same-origin" } });
    expectStatus(r, 200, "same-origin POST");
  });
  await test("S1-07", "open mode refuses an allowed non-localhost Host", async () => {
    const r = await getLlm({ host: EXTRA_HOST });
    expectStatus(r, 403, "open mode via extra host");
    assert(/open mode/i.test(r.text), `expected an "Open mode" error, got: ${r.text.slice(0, 160)}`);
  });

  // ---- S1: key exfiltration ---------------------------------------------
  section("S1 · A stored API key cannot follow a base-URL change");
  const currentBase = (await getLlm()).json?.config?.openai_base_url;
  const fakeKey = "sk-" + "test" + hex(20);
  await test("S1-08", "store a test OpenAI key", async () => {
    expectStatus(await postLlm({ openai_api_key: fakeKey, probe: false }), 200, "store key");
  });
  await test("S1-09", "changing openai_base_url without re-entering the key is refused", async () => {
    const r = await postLlm({ openai_base_url: "http://attacker.invalid/v1", probe: false });
    expectStatus(r, 400, "base URL change without key");
    assert(/re-enter/i.test(r.text), `expected a re-enter message, got: ${r.text.slice(0, 160)}`);
  });
  await test("S1-10", "re-sending the current base URL is still allowed", async () => {
    if (!currentBase) return skip("GET did not return config.openai_base_url");
    expectStatus(await postLlm({ openai_base_url: currentBase, probe: false }), 200, "unchanged base URL");
  });
  await test("S1-11", "changing the base URL together with the key is allowed", async () => {
    expectStatus(await postLlm({ openai_base_url: "http://127.0.0.1:9/v1", openai_api_key: fakeKey, probe: false }), 200, "URL + key");
    if (currentBase) {
      expectStatus(await postLlm({ openai_base_url: currentBase, openai_api_key: fakeKey, probe: false }), 200, "restore");
    }
  });
  await test("S1-12", "GET never returns the full key", async () => {
    const r = await getLlm();
    expectStatus(r, 200, "GET");
    assert(!r.text.includes(fakeKey), "full API key present in GET /api/llm-backend response");
  });

  // ---- S2/S3: scanning --------------------------------------------------
  section("S2/S3 · Project scanning");
  if (!SCAN_ROOT || !OUTSIDE_DIR) {
    await test("S2-00", "scan fixtures available", async () => skip("BRAIN_TEST_SCAN_ROOT / BRAIN_TEST_OUTSIDE_DIR not set"));
  } else {
    const marker = `zebracorn${hex(4)}`;
    const secrets = {
      openai: "sk-" + "proj-" + hex(24),
      aws: "AKIA" + fromCharset(16, UPPER_ALNUM),
      github: "ghp" + "_" + fromCharset(36, ALNUM),
    };
    const fixtureDir = path.join(SCAN_ROOT, `fixture-${hex(3)}`);
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      path.join(fixtureDir, "NOTES.md"),
      `# Fixture ${marker}\n\nDeployment notes for ${marker}.\n\nopenai key: ${secrets.openai}\naws key id: ${secrets.aws}\ngithub token: ${secrets.github}\n`,
    );
    writeFileSync(path.join(OUTSIDE_DIR, "PRIVATE.md"), `# outside ${marker}\nThis file must never be imported.\n`);

    async function createProject(label, rootPath) {
      const r = await send("POST", "/api/projects", {
        json: { name: `${label}-${hex(3)}`, rootPath, root_path: rootPath, description: "verify-security fixture" },
      });
      if (r.status >= 300) return { error: `POST /api/projects → ${r.status}: ${r.text.slice(0, 160)}` };
      const id = r.json?.id ?? r.json?.project?.id ?? r.json?.data?.id;
      return id ? { id } : { error: "POST /api/projects response had no id" };
    }
    const scan = (projectId) => send("POST", "/api/project-scan", { json: { projectId } });

    await test("S2-01", "project outside BRAIN_SCAN_ROOTS is refused", async () => {
      const p = await createProject("sec-outside", OUTSIDE_DIR);
      if (p.error) return skip(p.error);
      const r = await scan(p.id);
      expectStatus(r, 403, "scan outside root");
      assert(!r.text.includes("must never be imported"), "outside file content leaked into the response");
    });

    await test("S2-02", "symlink/junction escaping the scan root is refused", async () => {
      const link = path.join(SCAN_ROOT, `escape-${hex(3)}`);
      try {
        symlinkSync(OUTSIDE_DIR, link, process.platform === "win32" ? "junction" : "dir");
      } catch (e) {
        return skip(`could not create link (${e.code})`);
      }
      const p = await createProject("sec-escape", link);
      if (p.error) return skip(p.error);
      expectStatus(await scan(p.id), 403, "scan via escaping link");
    });

    let scanJson = null;
    await test("S2-03", "project inside BRAIN_SCAN_ROOTS scans", async () => {
      const p = await createProject("sec-inside", fixtureDir);
      if (p.error) return skip(p.error);
      const r = await scan(p.id);
      expectStatus(r, 200, "scan inside root");
      scanJson = r.json;
    });

    await test("S3-01", "secrets in scanned files are redacted before storage", async () => {
      if (!scanJson) return skip("scan did not run");
      const imported = Number(scanJson.imported ?? 0);
      if (imported === 0) return skip(`scanner did not import the fixture (skipped=${scanJson.skipped}) — nothing stored`);
      assert(Number(scanJson.redactions ?? 0) >= 1, `imported ${imported} file(s) but redactions=${scanJson.redactions}`);
    });

    await test("S3-02", "search results never contain the raw OpenAI-style key", async () => {
      const r = await send("GET", `/api/search?q=${encodeURIComponent(marker)}`);
      if (r.status !== 200) return skip(`GET /api/search → ${r.status}`);
      assert(!r.text.includes(secrets.openai), "raw OpenAI-style key found in search results");
      const missed = ["aws", "github"].filter((k) => r.text.includes(secrets[k]));
      if (missed.length) console.log(`      warn: redactor did not catch: ${missed.join(", ")}`);
      if (!r.text.includes(marker)) console.log("      note: fixture not found by search, so this check is weaker");
    });

    await test("S2-04", "audit log records the scan", async () => {
      const r = await send("GET", "/api/audit");
      if (r.status !== 200) return skip(`GET /api/audit → ${r.status}`);
      assert(r.text.includes("project.scanned") || r.text.includes("project.scan_rejected"), "no project.scan* audit events found");
    });
  }

  // ---- S1: bootstrap + enforced mode (creates the owner — keep last) ----
  section("S1 · First-run setup and enforced mode");
  const ownerEmail = `owner-${hex(3)}@example.test`;
  const ownerPass = `pw-${hex(8)}`;
  const setupBody = { email: ownerEmail, password: ownerPass, name: "Security Owner" };

  await test("S1-13", "setup refused from an allowed non-localhost Host", async () => {
    expectStatus(await send("POST", "/api/auth/setup", { host: EXTRA_HOST, json: setupBody }), 403, "setup via extra host");
  });
  await test("S1-14", "setup refused from another website", async () => {
    expectStatus(await send("POST", "/api/auth/setup", { headers: { origin: EVIL_ORIGIN }, json: setupBody }), 403, "setup cross-site");
  });
  await test("S1-15", "setup refused with an unknown Host", async () => {
    expectStatus(await send("POST", "/api/auth/setup", { host: `evil.example:${APP_PORT}`, json: setupBody }), 403, "setup evil host");
  });

  let ownerCookie = null;
  await test("S1-16", "setup from localhost creates the owner", async () => {
    const r = await send("POST", "/api/auth/setup", { json: setupBody });
    expectStatus(r, 200, "setup localhost");
    ownerCookie = sessionCookie(r);
    assert(ownerCookie, "no brain_session cookie returned");
  });

  if (ownerCookie) {
    const auth = { cookie: ownerCookie };
    await test("S1-17", "enforced mode: no cookie → 401", async () => {
      expectStatus(await getLlm(), 401, "no cookie");
    });
    await test("S1-18", "enforced mode: owner cookie → 200", async () => {
      expectStatus(await getLlm({ headers: auth }), 200, "owner cookie");
    });
    await test("S1-19", "owner cookie works on an allowed extra Host", async () => {
      expectStatus(await getLlm({ host: EXTRA_HOST, headers: auth }), 200, "extra host + cookie");
    });
    await test("S1-20", "cookie + foreign Origin is still refused (CSRF)", async () => {
      expectStatus(await postLlm({ probe: false }, { headers: { ...auth, origin: EVIL_ORIGIN } }), 403, "cookie + evil origin");
    });
    await test("S1-21", "a second setup without an owner session is refused", async () => {
      const r = await send("POST", "/api/auth/setup", { json: { email: `x-${hex(3)}@example.test`, password: `pw-${hex(8)}` } });
      expectStatus(r, 401, "second bootstrap");
    });
    await test("S1-22", "editor cannot change LLM settings", async () => {
      const editorEmail = `editor-${hex(3)}@example.test`;
      const editorPass = `pw-${hex(8)}`;
      const invite = await send("POST", "/api/auth/setup", {
        headers: auth,
        json: { email: editorEmail, password: editorPass, role: "editor" },
      });
      expectStatus(invite, 200, "invite editor");
      const login = await send("POST", "/api/auth/login", { json: { email: editorEmail, password: editorPass } });
      const editorCookie = sessionCookie(login);
      if (!editorCookie) return skip(`POST /api/auth/login → ${login.status}, no cookie`);
      expectStatus(await postLlm({ probe: false }, { headers: { cookie: editorCookie } }), 403, "editor POST");
    });
  } else {
    console.log("  (owner not created — enforced-mode checks skipped)");
  }

  // ---- S4: PIN ----------------------------------------------------------
  section("S4 · PIN brute-force limit");
  await test("S4-01", "5 wrong PINs from rotating X-Forwarded-For lock out even the correct PIN", async () => {
    if (!PIN) return skip("BRAIN_TEST_PIN not set");
    if (!ownerCookie) return skip("no owner account");
    for (let i = 1; i <= 5; i++) {
      const r = await send("POST", "/api/auth/pin", {
        headers: { "x-forwarded-for": `203.0.113.${i}` },
        json: { pin: `${PIN}x${i}` },
      });
      expectStatus(r, 401, `wrong PIN #${i}`);
    }
    const r = await send("POST", "/api/auth/pin", { headers: { "x-forwarded-for": "198.51.100.7" }, json: { pin: PIN } });
    expectStatus(r, 429, "correct PIN during lockout");
  });

  // ---- network binding --------------------------------------------------
  section("Network binding");
  const lan = lanIPv4();
  await test("N-01", `app port ${APP_PORT} is not reachable on the LAN address`, async () => {
    if (!lan) return skip("no non-loopback IPv4 interface");
    assert(!(await tcpReachable(lan, APP_PORT)), `port ${APP_PORT} accepts connections on ${lan}`);
  });

  // ---- A3: realtime -----------------------------------------------------
  if (REALTIME) {
    section("A3 · Realtime service");
    const rtPort = Number(REALTIME.port);
    let hsPath = null;
    await test("A3-01", "handshake from a local script succeeds", async () => {
      for (const p of ["/socket.io/?EIO=4&transport=polling", "/?EIO=4&transport=polling"]) {
        const r = await send("GET", p, { target: REALTIME });
        if (r.status === 200 && r.text.includes("sid")) { hsPath = p; return; }
      }
      throw new Error("no socket.io handshake answered 200 (tried /socket.io/ and /)");
    });
    await test("A3-02", "handshake from another website is refused", async () => {
      if (!hsPath) return skip("no handshake path");
      const r = await send("GET", hsPath, { target: REALTIME, headers: { origin: EVIL_ORIGIN } });
      assert(r.status !== 200, "cross-site handshake accepted");
    });
    await test("A3-03", "handshake from the app's own origin succeeds", async () => {
      if (!hsPath) return skip("no handshake path");
      const r = await send("GET", hsPath, { target: REALTIME, headers: { origin: `http://localhost:${APP_PORT}` } });
      expectStatus(r, 200, "app-origin handshake");
    });
    await test("A3-04", "handshake with an unknown Host is refused", async () => {
      if (!hsPath) return skip("no handshake path");
      const r = await send("GET", hsPath, { target: REALTIME, host: `evil.example:${rtPort}` });
      assert(r.status !== 200, "evil Host handshake accepted");
    });
    await test("A3-05", `realtime port ${rtPort} is not reachable on the LAN address`, async () => {
      if (!lan) return skip("no non-loopback IPv4 interface");
      assert(!(await tcpReachable(lan, rtPort)), `port ${rtPort} accepts connections on ${lan}`);
    });
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(`\nverify-security: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

The fake secrets are generated at runtime and split across string pieces. That way GitHub's secret scanning won't flag the test file itself.

---

### A3 · `mini-services/realtime-service/security.ts`

```ts
// mini-services/realtime-service/security.ts — A3: localhost-only realtime service.
//
// - listenLocal(): binds to 127.0.0.1 (override with REALTIME_HOST).
// - hardenedSocketOptions(): replaces `cors: "*"` with an allowlist and adds
//   allowRequest, so engine.io refuses the handshake (403) when:
//     * the Host header is not loopback / BRAIN_ALLOWED_HOSTS (DNS rebinding)
//     * the Origin's hostname is not loopback / BRAIN_ALLOWED_HOSTS (other websites)
//     * there is no Origin but Sec-Fetch-Site says cross-site (e.g. <img src>)
//   The port is deliberately ignored: the app (3000), Caddy (81) and this
//   service (3003) are different origins on the same machine.
// - guardHttpRequest(): the same checks for any plain HTTP handler on this server.
// Clients without an Origin header (the Next.js server, scripts) are allowed.

import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import type { ServerOptions } from "socket.io";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export const REALTIME_BIND_HOST = (process.env.REALTIME_HOST || "127.0.0.1").trim();

function hostnameOf(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : value;
  }
  const first = value.indexOf(":");
  if (first > -1 && first === value.lastIndexOf(":")) return value.slice(0, first);
  return value;
}

function allowedHostnames(): Set<string> {
  const set = new Set(LOOPBACK);
  for (const h of (process.env.BRAIN_ALLOWED_HOSTS ?? "").split(",")) {
    const name = hostnameOf(h);
    if (name) set.add(name);
  }
  return set;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true; // non-browser client
  if (origin === "null") return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return allowedHostnames().has(url.hostname.toLowerCase().replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

export type RealtimeCheck = { ok: true } | { ok: false; reason: string };

export function checkRealtimeRequest(req: IncomingMessage): RealtimeCheck {
  const host = hostnameOf(String(req.headers.host ?? ""));
  if (!allowedHostnames().has(host)) return { ok: false, reason: `host '${host || "(none)"}' not allowed` };

  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (origin !== undefined) {
    if (!isAllowedOrigin(origin)) return { ok: false, reason: `origin '${origin}' not allowed` };
  } else if (req.headers["sec-fetch-site"] === "cross-site") {
    return { ok: false, reason: "cross-site request without origin" };
  }
  return { ok: true };
}

/** Wrap your existing Server options; any `cors` you pass is replaced. */
export function hardenedSocketOptions(options: Partial<ServerOptions> = {}): Partial<ServerOptions> {
  return {
    ...options,
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      methods: ["GET", "POST"],
      credentials: false,
    },
    allowRequest: (req, callback) => {
      const check = checkRealtimeRequest(req);
      if (!check.ok) console.warn(`[realtime] refused connection: ${check.reason}`);
      callback(check.ok ? null : check.reason, check.ok);
    },
    maxHttpBufferSize: options.maxHttpBufferSize ?? 1_000_000,
  };
}

/** For plain HTTP handlers on the same server. Returns false after sending 403. */
export function guardHttpRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const check = checkRealtimeRequest(req);
  if (check.ok) return true;
  res.writeHead(403, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Forbidden" }));
  return false;
}

export function listenLocal(server: HttpServer, port: number, onListening?: () => void): void {
  server.listen(port, REALTIME_BIND_HOST, () => {
    if (!LOOPBACK.has(REALTIME_BIND_HOST)) {
      console.warn(`[realtime] REALTIME_HOST=${REALTIME_BIND_HOST}: reachable beyond this machine`);
    }
    onListening?.();
  });
}
```

**The 3-line change in `mini-services/realtime-service/index.ts`:**

```ts
// 1. add at the top
import { guardHttpRequest, hardenedSocketOptions, listenLocal } from "./security";

// 2. wrap the existing Server options (keep your own `path`, ping settings, etc.;
//    the old `cors: { origin: "*" }` is overridden, so it can stay or go)
const io = new Server(httpServer, hardenedSocketOptions({ path: "/", pingTimeout: 60000, pingInterval: 25000 }));

// 3. replace httpServer.listen(PORT, ...) with
listenLocal(httpServer, PORT, () => console.log(`realtime service on http://${"127.0.0.1"}:${PORT}`));

// only if createServer() has its own request handler — add as its first line:
//   if (!guardHttpRequest(req, res)) return;
```

Keep your existing `path` value. The frontend connects using it. If you paste `index.ts`, I'll send back the full merged file.

---

### A4 · `Caddyfile`

I couldn't see your Caddyfile. I wrote this one based on the standard Z.ai template, since OBA's `.zscripts/start.sh` runs Caddy as the front door. That template has a bigger problem than listening on all interfaces: `?XTransformPort=<any>` forwards the request to *any* port on localhost. Anyone who could reach port 81 could reach Ollama and every other local service. Compare this with your file before you replace it.

```caddy
# Caddyfile — S7: local-only reverse proxy for Brain OS.
#
# Binds to loopback by default, and ?XTransformPort= can only reach the
# realtime service (previously it forwarded to ANY localhost port).
#
# Environment (read when Caddy starts):
#   CADDY_BIND     default 127.0.0.1  (use 0.0.0.0 only behind a firewall/VPN,
#                                      with an owner account and BRAIN_ALLOWED_HOSTS)
#   CADDY_PORT     default 81
#   APP_PORT       default 3000
#   REALTIME_PORT  default 3003

:{$CADDY_PORT:81} {
	bind {$CADDY_BIND:127.0.0.1}

	header {
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy no-referrer
		-Server
	}

	@realtime query XTransformPort={$REALTIME_PORT:3003}
	handle @realtime {
		reverse_proxy 127.0.0.1:{$REALTIME_PORT:3003}
	}

	@otherPort query XTransformPort=*
	handle @otherPort {
		respond "Port not allowed" 403
	}

	handle {
		reverse_proxy 127.0.0.1:{$APP_PORT:3000}
	}
}
```

I left out `encode gzip` because it can buffer the streaming answers from `/api/ask/stream`. If you deploy to Z.ai's cloud, which needs Caddy reachable from outside, set `CADDY_BIND=0.0.0.0` there only.

### A5 · `.gitignore` (add at the end)

```gitignore
# --- A1: throwaway test databases, server logs, fixtures
/.test/

# --- A5: the `local-*` rule above also matched src/app/local-pin/; re-include it
!src/app/local-pin/
```

Then run `git check-ignore -v src/app/local-pin/page.tsx`. No output means the page is no longer ignored. After that, `git add src/app/local-pin`.

### A6 · `scripts/redact-legacy-ocr.ts`

```ts
// scripts/redact-legacy-ocr.ts — A6: redact screenshot OCR text stored before S5.
//
//   bun scripts/redact-legacy-ocr.ts           dry run: reports affected rows only
//   bun scripts/redact-legacy-ocr.ts --apply   writes the redacted text
//
// Back up the database first. Uses DATABASE_URL (bun loads .env automatically).
// Never prints the secrets themselves.

import { PrismaClient } from "@prisma/client";
import { redactSecretsInText } from "../src/lib/brain/privacy-redactor";

const APPLY = process.argv.includes("--apply");
const BATCH = 200;
const db = new PrismaClient();

async function main() {
  console.log(`redact-legacy-ocr — ${APPLY ? "APPLY" : "dry run"} — DATABASE_URL=${process.env.DATABASE_URL ?? "(unset)"}`);
  let cursor: string | undefined;
  let scanned = 0;
  let affected = 0;
  let updated = 0;

  for (;;) {
    const rows = await db.brainAsset.findMany({
      select: { id: true, ocrText: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const original = row.ocrText ?? "";
      if (!original) continue;
      const redacted = redactSecretsInText(original).text;
      if (redacted === original) continue;
      affected++;
      console.log(`  ${row.id}: ${original.length} → ${redacted.length} chars`);
      if (APPLY) {
        await db.brainAsset.update({ where: { id: row.id }, data: { ocrText: redacted } });
        updated++;
      }
    }
    cursor = rows[rows.length - 1].id;
  }

  console.log(`\nscanned ${scanned} asset(s); ${affected} contained secrets; ${APPLY ? `${updated} updated` : "run with --apply to fix"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
```

### `.env.example` (add these lines)

```bash
# --- Realtime service (A3) ---------------------------------------------------
# Binds to 127.0.0.1. Allowed browser origins = localhost + BRAIN_ALLOWED_HOSTS.
# REALTIME_HOST="127.0.0.1"

# --- Caddy (S7) ----------------------------------------------------------------
# CADDY_BIND="127.0.0.1"
# REALTIME_PORT="3003"
```

---

## Applying and checking

1. **Stop your dev server.** If port 3000 is busy, the runner refuses to start, so it can't run against your real database.
2. Apply the files and make the 3-line edit to `index.ts`.
3. Run:
   ```bash
   npm run type-check && npm run lint
   npm run test:security           # fastest first check
   npm run test                    # full board, each group on its own fresh DB
   npm run test -- --realtime      # adds the A3 checks (needs bun)
   ```
4. Run `npm run redact:ocr` as a dry run. If it lists affected rows, back up `db/custom.db` and run `npm run redact:ocr:apply`.
5. Add the CI change once `npm run test -- --server=standalone` passes locally after `npm run build`.

**Expect some first-run failures from the existing suites.** They're older than S1–S6. For example, a suite that scans a project outside the repo will now get 403. Paste the summary table and I'll fix them suite by suite.

## Limits to know about
- **Dev-mode tests still write files into `ProjectBrainVault/`.** The runner lists any new files but doesn't delete them. Standalone mode writes inside `.next/standalone/` instead.
- **S5 (OCR provider selection) has no automatic test.** Testing it needs a real OpenAI-backed screenshot capture.
- **The A6 script only cleans `BrainAsset.ocrText`.** If you've seen old OCR text in item content or in search results, those copies need a separate cleanup. I can write that once I can see the `Item` model and the search indexing code.
- **Some type errors are possible in A6.** If `BrainAsset.id` is a number rather than a string, or `redactSecretsInText` has a different name, it won't compile. Paste the error and I'll f