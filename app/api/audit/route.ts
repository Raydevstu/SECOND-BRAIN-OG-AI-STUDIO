import { NextRequest, NextResponse } from 'next/server';
import { apiGuard } from '@/lib/auth';
import { listAuditEvents } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = apiGuard(req, { mutation: false });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const events = listAuditEvents(100);
  return NextResponse.json({ events });
}
