import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  apiGuard,
  checkTrustedRequest,
  getAuthState,
  getJwtSecretForSetup,
  hashPassword,
  issueSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type Role,
} from '@/lib/auth';
import { createUserAccount, findUserByEmail, recordAuditEvent, upsertSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['owner', 'editor', 'viewer'];

export async function POST(req: NextRequest) {
  try {
    const trust = checkTrustedRequest(req);
    if (!trust.ok) {
      return NextResponse.json({ error: trust.error }, { status: trust.status });
    }

    const state = getAuthState();
    const bootstrap = state.accountCount === 0;
    if (bootstrap && !trust.loopback && !trust.previewHost) {
      return NextResponse.json(
        { error: 'The first owner account can only be created from localhost' },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const name = String(body.name ?? '').trim() || email.split('@')[0] || 'User';
    const password = String(body.password ?? '');
    const requestedRole = ROLES.includes(body.role as Role) ? (body.role as Role) : 'owner';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    let role: Role = 'owner';
    if (!bootstrap) {
      const gate = apiGuard(req, { mutation: true });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: gate.status });
      }
      if (gate.user?.role !== 'owner') {
        return NextResponse.json({ error: 'Only the owner can invite accounts' }, { status: 403 });
      }
      role = requestedRole;
    }

    if (findUserByEmail(email)) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    getJwtSecretForSetup();
    const account = createUserAccount({
      id: randomUUID(),
      email,
      name,
      passwordHash: hashPassword(password),
      role,
      lastLoginAt: bootstrap ? new Date().toISOString() : null,
    });

    if (bootstrap) {
      upsertSetting('auth_mode', 'enforced');
    }

    recordAuditEvent({
      actorType: 'user',
      actorId: account.id,
      eventType: bootstrap ? 'auth.owner_bootstrap' : 'auth.user_invited',
      entityType: 'UserAccount',
      entityId: account.id,
      details: { role: account.role },
    });

    const res = NextResponse.json({
      ok: true,
      invited: !bootstrap,
      user: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
      },
    });

    if (bootstrap) {
      const { token } = issueSessionToken({
        id: account.id,
        email: account.email,
        name: account.name,
        role: 'owner',
      });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_SECONDS,
        secure: false,
      });
    }

    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Setup failed' },
      { status: 500 }
    );
  }
}
