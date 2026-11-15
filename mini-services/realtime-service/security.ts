// mini-services/realtime-service/security.ts — A3: localhost-only realtime service.

import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { ServerOptions } from 'socket.io';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export const REALTIME_BIND_HOST = (process.env.REALTIME_HOST || '127.0.0.1').trim();

function hostnameOf(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : value;
  }
  const first = value.indexOf(':');
  if (first > -1 && first === value.lastIndexOf(':')) return value.slice(0, first);
  return value;
}

function allowedHostnames(): Set<string> {
  const set = new Set(LOOPBACK);
  for (const h of (process.env.BRAIN_ALLOWED_HOSTS ?? '').split(',')) {
    const name = hostnameOf(h);
    if (name) set.add(name);
  }
  return set;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return allowedHostnames().has(url.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

export type RealtimeCheck = { ok: true } | { ok: false; reason: string };

export function checkRealtimeRequest(req: IncomingMessage): RealtimeCheck {
  const host = hostnameOf(String(req.headers.host ?? ''));
  if (!allowedHostnames().has(host)) {
    return { ok: false, reason: `host '${host || '(none)'}' not allowed` };
  }

  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (origin !== undefined) {
    if (!isAllowedOrigin(origin)) return { ok: false, reason: `origin '${origin}' not allowed` };
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    return { ok: false, reason: 'cross-site request without origin' };
  }
  return { ok: true };
}

export function hardenedSocketOptions(options: Partial<ServerOptions> = {}): Partial<ServerOptions> {
  return {
    ...options,
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      methods: ['GET', 'POST'],
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

export function guardHttpRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const check = checkRealtimeRequest(req);
  if (check.ok) return true;
  res.writeHead(403, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Forbidden' }));
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
