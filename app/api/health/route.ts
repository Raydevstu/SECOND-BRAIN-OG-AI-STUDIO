import { NextResponse } from 'next/server';
import { getAuthState } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = getAuthState();
  return NextResponse.json({
    ok: true,
    mode: auth.mode,
    accountCount: auth.accountCount,
    db: 'sqlite',
  });
}
