import { NextRequest, NextResponse } from 'next/server';
import {
  checkTrustedRequest,
  issueSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifyPassword,
  type Role,
} from '@/lib/auth';
import { findUserByEmail, recordAuditEvent } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const trust = checkTrustedRequest(req);
    if (!trust.ok) {
      return NextResponse.json({ error: trust.error }, { status: trust.status });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const password = String(body.password ?? '');

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const account = findUserByEmail(email);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const { token, exp } = issueSessionToken({
      id: account.id,
      email: account.email,
      name: account.name,
      role: account.role as Role,
    });

    recordAuditEvent({
      actorType: 'user',
      actorId: account.id,
      eventType: 'auth.login',
      entityType: 'UserAccount',
      entityId: account.id,
      details: { role: account.role },
    });

    const res = NextResponse.json({
      ok: true,
      expires_at: exp,
      user: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
      },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      secure: false,
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Login failed' },
      { status: 500 }
    );
  }
}
