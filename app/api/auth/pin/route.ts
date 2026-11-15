import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  checkTrustedRequest,
  issueSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type Role,
} from '@/lib/auth';
import { findFirstOwner } from '@/lib/db';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PIN_LENGTH = 6;
const FAILURE_DELAY_MS = 400;

interface PinLimiter {
  failures: number[];
  lockedUntil: number;
}

const globalForPin = globalThis as unknown as { __cortexPinLimiter?: PinLimiter };
const limiter: PinLimiter =
  globalForPin.__cortexPinLimiter ?? (globalForPin.__cortexPinLimiter = { failures: [], lockedUntil: 0 });

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
  return req.headers.get('content-type')?.includes('application/x-www-form-urlencoded') ?? false;
}

function formRedirect(result: 'invalid' | 'disabled' | 'limited') {
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
  if (!trust.ok) {
    return NextResponse.json({ error: trust.error }, { status: trust.status });
  }

  const configuredPin = process.env.AUTH_LOCAL_PIN?.trim() ?? '';
  if (!configuredPin || configuredPin.length < MIN_PIN_LENGTH) {
    return form
      ? formRedirect('disabled')
      : NextResponse.json({ error: 'Local PIN login is not enabled' }, { status: 404 });
  }

  if (isLocked(Date.now())) {
    return form
      ? formRedirect('limited')
      : NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  try {
    const body = form
      ? (Object.fromEntries(await req.formData()) as Record<string, unknown>)
      : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
    const pin = String(body.pin ?? '');

    if (!sameSecret(pin, configuredPin)) {
      recordFailure(Date.now());
      await sleep(FAILURE_DELAY_MS);
      return form
        ? formRedirect('invalid')
        : NextResponse.json({ error: 'Invalid local PIN' }, { status: 401 });
    }

    const owner = findFirstOwner();
    if (!owner) {
      return form
        ? formRedirect('disabled')
        : NextResponse.json({ error: 'No owner account is configured' }, { status: 404 });
    }

    resetLimiter();

    const { token, exp } = issueSessionToken({
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role as Role,
    });

    const res = form
      ? new NextResponse(null, { status: 303, headers: { Location: '/?pin-login=1' } })
      : NextResponse.json({ ok: true, expires_at: exp });

    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      secure: false,
    });
    return res;
  } catch (error) {
    return form
      ? formRedirect('invalid')
      : NextResponse.json(
          { error: error instanceof Error ? error.message : 'PIN login failed' },
          { status: 500 }
        );
  }
}
