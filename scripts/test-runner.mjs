#!/usr/bin/env node
// scripts/test-runner.mjs — A1: run security & verification suites against throwaway SQLite databases.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const IS_WIN = process.platform === 'win32';
const opts = parseArgs(process.argv.slice(2));
const SERVER_MODE = opts.server === 'standalone' ? 'standalone' : 'dev';
const PORT = Number(opts.port ?? 3000);
const REALTIME_PORT = Number(opts['realtime-port'] ?? process.env.REALTIME_PORT ?? 3003);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_DIR = path.join(ROOT, '.test', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const VAULT_DIR = path.join(ROOT, 'ProjectBrainVault');
const children = new Set();

const GROUPS = [
  {
    name: 'security',
    suites: ['verify-security'],
    env: (dir) => {
      const scanRoot = path.join(dir, 'scan-root');
      const outside = path.join(dir, 'outside');
      mkdirSync(scanRoot, { recursive: true });
      mkdirSync(outside, { recursive: true });
      return {
        BRAIN_SCAN_ROOTS: scanRoot,
        BRAIN_ALLOWED_HOSTS: 'brain-test.local',
        BRAIN_TEST_ALLOWED_HOST: 'brain-test.local',
        AUTH_LOCAL_PIN: '246810',
        BRAIN_TEST_PIN: '246810',
        BRAIN_TEST_SCAN_ROOT: scanRoot,
        BRAIN_TEST_OUTSIDE_DIR: outside,
      };
    },
  },
];

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
const toPosix = (p) => p.replace(/\\/g, '/');

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function realDbCandidates() {
  const c = new Set([path.join(ROOT, 'db', 'custom.db'), path.join(ROOT, 'prisma', 'db', 'custom.db')]);
  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*DATABASE_URL\s*=\s*["']?file:([^"'\r\n]+)/m);
    if (m) {
      const p = m[1].trim();
      if (path.isAbsolute(p)) c.add(p);
      else {
        c.add(path.resolve(ROOT, p));
        c.add(path.resolve(ROOT, 'prisma', p));
      }
    }
  }
  return [...c];
}

function fingerprintRealDb() {
  const out = {};
  for (const base of realDbCandidates()) {
    for (const suffix of ['', '-wal', '-journal']) {
      const f = base + suffix;
      if (existsSync(f)) {
        const s = statSync(f);
        out[f] = `${s.size}:${s.mtimeMs}`;
      }
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
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function printTail(file, lines = 60) {
  const text = safeRead(file);
  if (!text) return;
  console.log(`\n── last ${lines} lines of ${path.relative(ROOT, file)}`);
  console.log(text.split(/\r?\n/).slice(-lines).join('\n'));
}

function buildEnv(overrides) {
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    BRAIN_TEST_MODE: '1',
    BRAIN_PRISMA_LOG_QUERIES: '0',
    BASE_URL,
    BRAIN_BASE_URL: BASE_URL,
    BRAIN_URL: BASE_URL,
    API_BASE: BASE_URL,
    ...overrides,
  };
  if (SERVER_MODE === 'dev') delete env.NODE_ENV;
  return env;
}

function initThrowawayDb(dbFile) {
  const { DatabaseSync } = require('node:sqlite');
  mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS Setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS UserAccount (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, passwordHash TEXT NOT NULL, role TEXT NOT NULL, lastLoginAt TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS Project (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT NOT NULL, rootPath TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS Item (id TEXT PRIMARY KEY, projectId TEXT, title TEXT NOT NULL, content TEXT NOT NULL, sourceApp TEXT NOT NULL, metadata TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS BrainAsset (id TEXT PRIMARY KEY, projectId TEXT, filePath TEXT NOT NULL, mimeType TEXT NOT NULL, ocrText TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS AuditEvent (id TEXT PRIMARY KEY, projectId TEXT, actorType TEXT NOT NULL, actorId TEXT, eventType TEXT NOT NULL, entityType TEXT NOT NULL, entityId TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL);
  `);
  db.close();
}

function startServer(env, logFile) {
  let args;
  const serverEnv = { ...env };
  if (SERVER_MODE === 'standalone') {
    const entry = path.join(ROOT, '.next', 'standalone', 'server.js');
    if (!existsSync(entry)) throw new Error(`${path.relative(ROOT, entry)} not found — run \`npm run build\` first`);
    args = [entry];
    Object.assign(serverEnv, { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(PORT) });
  } else {
    args = [NEXT_BIN, 'dev', '-H', '127.0.0.1', '-p', String(PORT)];
  }
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: serverEnv,
    stdio: ['ignore', fd, fd],
    detached: !IS_WIN,
    windowsHide: true,
  });
  closeSync(fd);
  children.add(child);
  const state = { child, exited: null };
  child.on('exit', (code, signal) => {
    state.exited = { code, signal };
    children.delete(child);
  });
  return state;
}

async function waitForHealth(server, timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exited) throw new Error(`server exited early (code ${server.exited.code})`);
    try {
      const r = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        console.log(`  server ready in ${Math.round((Date.now() - started) / 1000)}s (${SERVER_MODE})`);
        return;
      }
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`server not responding after ${timeoutMs / 1000}s`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    children.delete(child);
    return;
  }
  const exited = new Promise((r) => child.once('exit', r));
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  const done = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
  if (!done && !IS_WIN) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
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
  const dir = path.join(ROOT, 'mini-services', 'realtime-service');
  if (!existsSync(path.join(dir, 'index.ts'))) throw new Error('mini-services/realtime-service/index.ts not found');
  const fd = openSync(path.join(RUN_DIR, 'realtime.log'), 'a');
  const child = spawn('bun', ['index.ts'], {
    cwd: dir,
    env: { ...process.env, PORT: String(REALTIME_PORT), REALTIME_PORT: String(REALTIME_PORT) },
    stdio: ['ignore', fd, fd],
    detached: !IS_WIN,
    windowsHide: true,
  });
  closeSync(fd);
  children.add(child);
  let spawnError = null;
  child.on('error', (e) => {
    spawnError = e;
  });
  for (let i = 0; i < 40; i++) {
    if (spawnError) throw new Error(`could not start realtime service with bun: ${spawnError.message}`);
    if (await portOpen(REALTIME_PORT)) {
      console.log(`realtime: started on ${REALTIME_PORT}`);
      return { url, child };
    }
    await sleep(500);
  }
  await stopProcess(child);
  throw new Error(`realtime service did not listen on ${REALTIME_PORT} (see .test/…/realtime.log)`);
}

function selectGroups() {
  if (!opts.only) return GROUPS;
  const wanted = new Set(
    String(opts.only)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const picked = [];
  for (const g of GROUPS) {
    if (wanted.has(g.name)) {
      picked.push(g);
      continue;
    }
    const suites = g.suites.filter((s) => wanted.has(s));
    if (suites.length) picked.push({ ...g, suites });
  }
  if (!picked.length) fail(`--only=${opts.only} matched nothing. Groups: ${GROUPS.map((g) => g.name).join(', ')}`);
  return picked;
}

async function runGroup(group, realtime) {
  const dir = path.join(RUN_DIR, group.name);
  mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'brain.db');
  const logFile = path.join(dir, 'server.log');
  const outcomes = [];
  let failed = false;
  let server = null;

  console.log(`\n▶ ${group.name}: fresh database ${path.relative(ROOT, dbFile)}`);
  try {
    initThrowawayDb(dbFile);
    const env = buildEnv({
      DATABASE_URL: `file:${toPosix(dbFile)}`,
      ...group.env(dir),
      ...(realtime ? { REALTIME_URL: realtime.url } : {}),
    });
    server = startServer(env, logFile);
    await waitForHealth(server);

    for (const suite of group.suites) {
      const script = path.join(ROOT, 'scripts', `${suite}.mjs`);
      if (!existsSync(script)) {
        outcomes.push({ group: group.name, suite, status: 'fail', note: 'script not found' });
        failed = true;
        continue;
      }
      console.log(`\n── ${suite}`);
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [script], { cwd: ROOT, env, stdio: 'inherit' });
      const ok = r.status === 0;
      outcomes.push({
        group: group.name,
        suite,
        status: ok ? 'pass' : 'fail',
        note: `${Math.round((Date.now() - t0) / 1000)}s`,
      });
      if (!ok) {
        failed = true;
        if (opts.bail) break;
      }
    }
  } catch (e) {
    failed = true;
    outcomes.push({
      group: group.name,
      suite: '(setup)',
      status: 'fail',
      note: e instanceof Error ? e.message : String(e),
    });
    printTail(logFile);
  } finally {
    if (server) await stopProcess(server.child);
  }

  const serverLogText = safeRead(logFile);
  if (/prisma:query|\[sql\]\s+(?:SELECT|INSERT|UPDATE|DELETE)/i.test(serverLogText)) {
    failed = true;
    outcomes.push({ group: group.name, suite: 'S6 log check', status: 'fail', note: 'server log contains SQL query lines' });
  } else {
    outcomes.push({ group: group.name, suite: 'S6 log check', status: 'pass' });
  }
  return { outcomes, failed };
}

async function main() {
  if (!existsSync(NEXT_BIN)) fail('node_modules missing — run `npm install` first');
  if (await portOpen(PORT)) {
    fail(
      `Port ${PORT} is already in use. Pass --port=3100 or stop your dev server first so tests never touch your real DB.`
    );
  }

  const groups = selectGroups();
  const dbBefore = fingerprintRealDb();
  const vaultBefore = new Set(listFiles(VAULT_DIR));
  mkdirSync(RUN_DIR, { recursive: true });

  process.on('SIGINT', async () => {
    console.log('\ninterrupted — stopping test processes');
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
      if (r.failed) {
        failed = true;
        if (opts.bail) break;
      }
    }
  } catch (e) {
    failed = true;
    outcomes.push({ group: '-', suite: '(runner)', status: 'fail', note: e instanceof Error ? e.message : String(e) });
  } finally {
    if (realtime?.child) await stopProcess(realtime.child);
  }

  const touched = changedKeys(dbBefore, fingerprintRealDb());
  if (touched.length) {
    failed = true;
    outcomes.push({ group: '-', suite: 'real DB untouched', status: 'fail', note: `changed: ${touched.join(', ')}` });
  } else {
    outcomes.push({ group: '-', suite: 'real DB untouched', status: 'pass' });
  }

  const newVaultFiles = listFiles(VAULT_DIR).filter((f) => !vaultBefore.has(f));
  if (newVaultFiles.length) {
    console.log(`\nnote: ${newVaultFiles.length} new file(s) in ProjectBrainVault/:`);
    for (const f of newVaultFiles.slice(0, 10)) console.log(`  ${path.relative(ROOT, f)}`);
  }

  console.log('\n══ Summary');
  const icon = { pass: '✓', fail: '✗' };
  for (const o of outcomes) {
    console.log(`  ${icon[o.status] ?? '-'} ${o.group.padEnd(11)} ${o.suite}${o.note ? `  (${o.note})` : ''}`);
  }

  if (!failed && !opts.keep) rmSync(RUN_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  else console.log(`\nartifacts kept in ${path.relative(ROOT, RUN_DIR)}`);
  process.exit(failed ? 1 : 0);
}

main();
