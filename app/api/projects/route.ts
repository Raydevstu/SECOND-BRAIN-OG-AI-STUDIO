import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { apiGuard } from '@/lib/auth';
import { createProjectRow, listProjects, recordAuditEvent } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = apiGuard(req, { mutation: false });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const projects = listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const gate = apiGuard(req, { mutation: true });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  const rootPath = String(body.rootPath ?? body.root_path ?? '').trim();
  const description = String(body.description ?? '').trim();

  if (!name) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';

  const project = createProjectRow({
    id: randomUUID(),
    name,
    slug,
    description,
    rootPath,
  });

  recordAuditEvent({
    projectId: project.id,
    actorType: gate.user ? 'user' : 'system',
    actorId: gate.user?.id ?? null,
    eventType: 'project.created',
    entityType: 'Project',
    entityId: project.id,
    details: { name: project.name },
  });

  return NextResponse.json({ id: project.id, project });
}
