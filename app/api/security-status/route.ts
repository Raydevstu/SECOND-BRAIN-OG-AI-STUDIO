import { NextRequest, NextResponse } from 'next/server';
import { apiGuard, getAuthState } from '@/lib/auth';
import { listAuditEvents } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = apiGuard(req, { mutation: false });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const auth = getAuthState();
  const scanRoots = (process.env.BRAIN_SCAN_ROOTS ?? '')
    .split(process.platform === 'win32' ? /[;,]/ : /[;,:]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return NextResponse.json({
    authMode: auth.mode,
    accountCount: auth.accountCount,
    scanRootsConfigured: scanRoots.length > 0,
    scanRootsCount: scanRoots.length,
    queryLoggingEnabled: process.env.BRAIN_PRISMA_LOG_QUERIES === '1',
    cloudOcrDisabled: process.env.BRAIN_DISABLE_CLOUD_OCR === '1',
    recentAuditEvents: listAuditEvents(8),
  });
}
