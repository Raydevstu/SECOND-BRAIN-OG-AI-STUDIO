#!/usr/bin/env node
// scripts/verify-security.mjs — A2: regression tests for S1–S7 and A3 fixes.

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';

if (process.env.BRAIN_TEST_MODE !== '1' && !process.argv.includes('--i-know-this-mutates')) {
  console.error(
    'verify-security: refusing to run outside scripts/test-runner.mjs (it creates accounts and locks PIN login). Use `npm run test:security`.'
  );
  process.exit(2);
}

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:3000');
const APP_PORT = Number(BASE.port || 80);
const LOCAL = `127.0.0.1:${APP_PORT}`;
const EXTRA_HOST = `${process.env.BRAIN_TEST_ALLOWED_HOST || 'brain-test.local'}:${APP_PORT}`;
const EVIL_ORIGIN = 'http://evil.example';
const PIN = process.env.BRAIN_TEST_PIN || '';
const SCAN_ROOT = process.env.BRAIN_TEST_SCAN_ROOT || '';
const OUTSIDE_DIR = process.env.BRAIN_TEST_OUTSIDE_DIR || '';
const REALTIME = process.env.REALTIME_URL ? new URL(process.env.REALTIME_URL) : null;

const hex = (n = 8) => randomBytes(n).toString('hex');
function fromCharset(len, charset) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => charset[b % charset.length]).join('');
}
const UPPER_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function send(method, urlPath, { target = BASE, host, headers = {}, json, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = json !== undefined ? JSON.stringify(json) : body;
    const h = { host: host ?? target.host, ...headers };
    if (json !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
      h['content-type'] = 'application/json';
    }
    if (payload !== undefined) h['content-length'] = Buffer.byteLength(payload);
    const req = http.request(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: Number(target.port || 80),
        method,
        path: urlPath,
        headers: h,
        timeout: 120_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timeout: ${method} ${urlPath}`)));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function sessionCookie(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = list.find((c) => c.startsWith('brain_session='));
  return hit ? hit.split(';')[0] : null;
}

function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1500, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function lanIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
    }
  }
  return null;
}

const results = [];
const skip = (why) => ({ skip: why });
function section(title) {
  console.log(`\n${title}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function expectStatus(res, expected, ctx) {
  const list = Array.isArray(expected) ? expected : [expected];
  if (!list.includes(res.status)) {
    throw new Error(`${ctx}: expected ${list.join('/')}, got ${res.status} — ${res.text.slice(0, 200)}`);
  }
}
async function test(id, name, fn) {
  try {
    const r = await fn();
    if (r && r.skip) {
      results.push({ id, status: 'skip' });
      console.log(`  - SKIP ${id} ${name} — ${r.skip}`);
    } else {
      results.push({ id, status: 'pass' });
      console.log(`  ✓ ${id} ${name}`);
    }
  } catch (e) {
    results.push({ id, status: 'fail' });
    console.log(`  ✗ ${id} ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
  }
}

const getLlm = (o = {}) => send('GET', '/api/llm-backend', o);
const postLlm = (json, o = {}) => send('POST', '/api/llm-backend', { json, ...o });

async function main() {
  console.log(`verify-security → ${BASE.origin}`);
  const pre = await getLlm();
  if (pre.status !== 200) {
    console.error(
      `pre-flight: expected open mode (200 from GET /api/llm-backend), got ${pre.status}. This suite needs a fresh database.`
    );
    process.exit(1);
  }

  section('S1 · Host and origin checks (open mode)');
  await test('S1-01', 'unknown Host header is refused (DNS rebinding)', async () => {
    expectStatus(await getLlm({ host: `evil.example:${APP_PORT}` }), 403, 'Host evil.example');
  });
  await test('S1-02', 'request from another website is refused (Origin)', async () => {
    expectStatus(await postLlm({ probe: false }, { headers: { origin: EVIL_ORIGIN } }), 403, 'Origin evil');
  });
  await test('S1-03', 'Sec-Fetch-Site: cross-site is refused', async () => {
    expectStatus(await postLlm({ probe: false }, { headers: { 'sec-fetch-site': 'cross-site' } }), 403, 'cross-site');
  });
  await test('S1-04', 'Origin: null (sandboxed iframe) is refused', async () => {
    expectStatus(await postLlm({ probe: false }, { headers: { origin: 'null' } }), 403, 'Origin null');
  });
  await test('S1-05', 'text/plain CSRF body from another site is refused', async () => {
    const r = await send('POST', '/api/llm-backend', {
      headers: { origin: EVIL_ORIGIN, 'content-type': 'text/plain' },
      body: JSON.stringify({ provider: 'offline', probe: false }),
    });
    expectStatus(r, 403, 'text/plain CSRF');
  });
  await test('S1-06', 'same-origin browser request is accepted', async () => {
    const r = await postLlm(
      { probe: false },
      { headers: { origin: `http://${LOCAL}`, 'sec-fetch-site': 'same-origin' } }
    );
    expectStatus(r, 200, 'same-origin POST');
  });
  await test('S1-07', 'open mode refuses an allowed non-localhost Host', async () => {
    const r = await getLlm({ host: EXTRA_HOST });
    expectStatus(r, 403, 'open mode via extra host');
    assert(/open mode/i.test(r.text), `expected an "Open mode" error, got: ${r.text.slice(0, 160)}`);
  });

  section('S1 · A stored API key cannot follow a base-URL change');
  const currentBase = (await getLlm()).json?.config?.openai_base_url;
  const fakeKey = 'sk-' + 'test' + hex(20);
  await test('S1-08', 'store a test OpenAI key', async () => {
    expectStatus(await postLlm({ openai_api_key: fakeKey, probe: false }), 200, 'store key');
  });
  await test('S1-09', 'changing openai_base_url without re-entering the key is refused', async () => {
    const r = await postLlm({ openai_base_url: 'http://attacker.invalid/v1', probe: false });
    expectStatus(r, 400, 'base URL change without key');
    assert(/re-enter/i.test(r.text), `expected a re-enter message, got: ${r.text.slice(0, 160)}`);
  });
  await test('S1-10', 're-sending the current base URL is still allowed', async () => {
    if (!currentBase) return skip('GET did not return config.openai_base_url');
    expectStatus(await postLlm({ openai_base_url: currentBase, probe: false }), 200, 'unchanged base URL');
  });
  await test('S1-11', 'changing the base URL together with the key is allowed', async () => {
    expectStatus(
      await postLlm({ openai_base_url: 'http://127.0.0.1:9/v1', openai_api_key: fakeKey, probe: false }),
      200,
      'URL + key'
    );
    if (currentBase) {
      expectStatus(await postLlm({ openai_base_url: currentBase, openai_api_key: fakeKey, probe: false }), 200, 'restore');
    }
  });
  await test('S1-12', 'GET never returns the full key', async () => {
    const r = await getLlm();
    expectStatus(r, 200, 'GET');
    assert(!r.text.includes(fakeKey), 'full API key present in GET /api/llm-backend response');
  });

  section('S2/S3 · Project scanning');
  if (!SCAN_ROOT || !OUTSIDE_DIR) {
    await test('S2-00', 'scan fixtures available', async () =>
      skip('BRAIN_TEST_SCAN_ROOT / BRAIN_TEST_OUTSIDE_DIR not set')
    );
  } else {
    const marker = `zebracorn${hex(4)}`;
    const secrets = {
      openai: 'sk-' + 'proj-' + hex(24),
      aws: 'AKIA' + fromCharset(16, UPPER_ALNUM),
      github: 'ghp' + '_' + fromCharset(36, ALNUM),
    };
    const fixtureDir = path.join(SCAN_ROOT, `fixture-${hex(3)}`);
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      path.join(fixtureDir, 'NOTES.md'),
      `# Fixture ${marker}\n\nDeployment notes for ${marker}.\n\nopenai key: ${secrets.openai}\naws key id: ${secrets.aws}\ngithub token: ${secrets.github}\n`
    );
    writeFileSync(path.join(OUTSIDE_DIR, 'PRIVATE.md'), `# outside ${marker}\nThis file must never be imported.\n`);

    async function createProject(label, rootPath) {
      const r = await send('POST', '/api/projects', {
        json: { name: `${label}-${hex(3)}`, rootPath, root_path: rootPath, description: 'verify-security fixture' },
      });
      if (r.status >= 300) return { error: `POST /api/projects → ${r.status}: ${r.text.slice(0, 160)}` };
      const id = r.json?.id ?? r.json?.project?.id ?? r.json?.data?.id;
      return id ? { id } : { error: 'POST /api/projects response had no id' };
    }
    const scan = (projectId) => send('POST', '/api/project-scan', { json: { projectId } });

    await test('S2-01', 'project outside BRAIN_SCAN_ROOTS is refused', async () => {
      const p = await createProject('sec-outside', OUTSIDE_DIR);
      if (p.error) return skip(p.error);
      const r = await scan(p.id);
      expectStatus(r, 403, 'scan outside root');
      assert(!r.text.includes('must never be imported'), 'outside file content leaked into the response');
    });

    await test('S2-02', 'symlink/junction escaping the scan root is refused', async () => {
      const link = path.join(SCAN_ROOT, `escape-${hex(3)}`);
      try {
        symlinkSync(OUTSIDE_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (e) {
        return skip(`could not create link (${e.code})`);
      }
      const p = await createProject('sec-escape', link);
      if (p.error) return skip(p.error);
      expectStatus(await scan(p.id), 403, 'scan via escaping link');
    });

    let scanJson = null;
    await test('S2-03', 'project inside BRAIN_SCAN_ROOTS scans', async () => {
      const p = await createProject('sec-inside', fixtureDir);
      if (p.error) return skip(p.error);
      const r = await scan(p.id);
      expectStatus(r, 200, 'scan inside root');
      scanJson = r.json;
    });

    await test('S3-01', 'secrets in scanned files are redacted before storage', async () => {
      if (!scanJson) return skip('scan did not run');
      const imported = Number(scanJson.imported ?? 0);
      if (imported === 0) return skip(`scanner did not import the fixture (skipped=${scanJson.skipped})`);
      assert(Number(scanJson.redactions ?? 0) >= 1, `imported ${imported} file(s) but redactions=${scanJson.redactions}`);
    });

    await test('S3-02', 'search results never contain the raw OpenAI-style key', async () => {
      const r = await send('GET', `/api/search?q=${encodeURIComponent(marker)}`);
      if (r.status !== 200) return skip(`GET /api/search → ${r.status}`);
      assert(!r.text.includes(secrets.openai), 'raw OpenAI-style key found in search results');
      assert(!r.text.includes(secrets.aws), 'raw AWS key found in search results');
      assert(!r.text.includes(secrets.github), 'raw GitHub token found in search results');
      assert(r.text.includes(marker), 'expected marker not found in search results');
    });

    await test('S2-04', 'audit log records the scan', async () => {
      const r = await send('GET', '/api/audit');
      if (r.status !== 200) return skip(`GET /api/audit → ${r.status}`);
      assert(
        r.text.includes('project.scanned') || r.text.includes('project.scan_rejected'),
        'no project.scan* audit events found'
      );
    });
  }

  section('S1 · First-run setup and enforced mode');
  const ownerEmail = `owner-${hex(3)}@example.test`;
  const ownerPass = `pw-${hex(8)}`;
  const setupBody = { email: ownerEmail, password: ownerPass, name: 'Security Owner' };

  await test('S1-13', 'setup refused from an allowed non-localhost Host', async () => {
    expectStatus(await send('POST', '/api/auth/setup', { host: EXTRA_HOST, json: setupBody }), 403, 'setup via extra host');
  });
  await test('S1-14', 'setup refused from another website', async () => {
    expectStatus(
      await send('POST', '/api/auth/setup', { headers: { origin: EVIL_ORIGIN }, json: setupBody }),
      403,
      'setup cross-site'
    );
  });
  await test('S1-15', 'setup refused with an unknown Host', async () => {
    expectStatus(
      await send('POST', '/api/auth/setup', { host: `evil.example:${APP_PORT}`, json: setupBody }),
      403,
      'setup evil host'
    );
  });

  let ownerCookie = null;
  await test('S1-16', 'setup from localhost creates the owner', async () => {
    const r = await send('POST', '/api/auth/setup', { json: setupBody });
    expectStatus(r, 200, 'setup localhost');
    ownerCookie = sessionCookie(r);
    assert(ownerCookie, 'no brain_session cookie returned');
  });

  if (ownerCookie) {
    const auth = { cookie: ownerCookie };
    await test('S1-17', 'enforced mode: no cookie → 401', async () => {
      expectStatus(await getLlm(), 401, 'no cookie');
    });
    await test('S1-18', 'enforced mode: owner cookie → 200', async () => {
      expectStatus(await getLlm({ headers: auth }), 200, 'owner cookie');
    });
    await test('S1-19', 'owner cookie works on an allowed extra Host', async () => {
      expectStatus(await getLlm({ host: EXTRA_HOST, headers: auth }), 200, 'extra host + cookie');
    });
    await test('S1-20', 'cookie + foreign Origin is still refused (CSRF)', async () => {
      expectStatus(
        await postLlm({ probe: false }, { headers: { ...auth, origin: EVIL_ORIGIN } }),
        403,
        'cookie + evil origin'
      );
    });
    await test('S1-21', 'a second setup without an owner session is refused', async () => {
      const r = await send('POST', '/api/auth/setup', {
        json: { email: `x-${hex(3)}@example.test`, password: `pw-${hex(8)}` },
      });
      expectStatus(r, 401, 'second bootstrap');
    });
    await test('S1-22', 'editor cannot change LLM settings', async () => {
      const editorEmail = `editor-${hex(3)}@example.test`;
      const editorPass = `pw-${hex(8)}`;
      const invite = await send('POST', '/api/auth/setup', {
        headers: auth,
        json: { email: editorEmail, password: editorPass, role: 'editor' },
      });
      expectStatus(invite, 200, 'invite editor');
      const login = await send('POST', '/api/auth/login', { json: { email: editorEmail, password: editorPass } });
      const editorCookie = sessionCookie(login);
      if (!editorCookie) return skip(`POST /api/auth/login → ${login.status}, no cookie`);
      expectStatus(await postLlm({ probe: false }, { headers: { cookie: editorCookie } }), 403, 'editor POST');
    });
  }

  section('S4 · PIN brute-force limit');
  await test('S4-01', '5 wrong PINs from rotating X-Forwarded-For lock out even the correct PIN', async () => {
    if (!PIN) return skip('BRAIN_TEST_PIN not set');
    if (!ownerCookie) return skip('no owner account');
    for (let i = 1; i <= 5; i++) {
      const r = await send('POST', '/api/auth/pin', {
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
        json: { pin: `${PIN}x${i}` },
      });
      expectStatus(r, 401, `wrong PIN #${i}`);
    }
    const r = await send('POST', '/api/auth/pin', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
      json: { pin: PIN },
    });
    expectStatus(r, 429, 'correct PIN during lockout');
  });

  section('Network binding');
  const lan = lanIPv4();
  await test('N-01', `app port ${APP_PORT} is not reachable on the LAN address`, async () => {
    if (!lan) return skip('no non-loopback IPv4 interface');
    assert(!(await tcpReachable(lan, APP_PORT)), `port ${APP_PORT} accepts connections on ${lan}`);
  });

  if (REALTIME) {
    section('A3 · Realtime service');
    const rtPort = Number(REALTIME.port);
    let hsPath = null;
    await test('A3-01', 'handshake from a local script succeeds', async () => {
      for (const p of ['/socket.io/?EIO=4&transport=polling', '/?EIO=4&transport=polling']) {
        const r = await send('GET', p, { target: REALTIME });
        if (r.status === 200 && r.text.includes('sid')) {
          hsPath = p;
          return;
        }
      }
      throw new Error('no socket.io handshake answered 200 (tried /socket.io/ and /)');
    });
    await test('A3-02', 'handshake from another website is refused', async () => {
      if (!hsPath) return skip('no handshake path');
      const r = await send('GET', hsPath, { target: REALTIME, headers: { origin: EVIL_ORIGIN } });
      assert(r.status !== 200, 'cross-site handshake accepted');
    });
    await test('A3-03', "handshake from the app's own origin succeeds", async () => {
      if (!hsPath) return skip('no handshake path');
      const r = await send('GET', hsPath, {
        target: REALTIME,
        headers: { origin: `http://localhost:${APP_PORT}` },
      });
      expectStatus(r, 200, 'app-origin handshake');
    });
    await test('A3-04', 'handshake with an unknown Host is refused', async () => {
      if (!hsPath) return skip('no handshake path');
      const r = await send('GET', hsPath, { target: REALTIME, host: `evil.example:${rtPort}` });
      assert(r.status !== 200, 'evil Host handshake accepted');
    });
    await test('A3-05', `realtime port ${rtPort} is not reachable on the LAN address`, async () => {
      if (!lan) return skip('no non-loopback IPv4 interface');
      assert(!(await tcpReachable(lan, rtPort)), `port ${rtPort} accepts connections on ${lan}`);
    });
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  console.log(`\nverify-security: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
