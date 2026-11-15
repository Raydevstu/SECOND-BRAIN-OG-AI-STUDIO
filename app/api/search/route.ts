import { NextRequest, NextResponse } from 'next/server';
import { apiGuard } from '@/lib/auth';
import { searchItems } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = apiGuard(req, { mutation: false });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const results = searchItems(q);
  return NextResponse.json({ results });
}
