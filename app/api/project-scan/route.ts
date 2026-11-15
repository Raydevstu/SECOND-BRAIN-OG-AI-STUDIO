import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { apiGuard } from '@/lib/auth';
import {
  createItemRow,
  getProjectById,
  getSetting,
  listItemsByProject,
  recordAuditEvent,
  upsertSetting,
} from '@/lib/db';
import { redactSecretsInText } from '@/lib/privacy-redactor';
import { isSafeProjectPath, scanProjectFiles } from '@/lib/project-scanner';

export const dynamic = 'force-dynamic';

const MAX_FILES_PER_SCAN = 2000;
const MAX_CONTENT_CHARS = 150_000;

function configuredScanRoots(): string[] {
  const separator = process.platform === 'win32' ? /[;,]/ : /[;,:]/;
  return (process.env.BRAIN_SCAN_ROOTS ?? '')
    .split(separator)
    .map((p) => p.trim())
    .filter(Boolean);
}

type RootCheck = { ok: true; root: string } | { ok: false; status: 400 | 403; error: string };

async function resolveAllowedRoot(rootPath: string): Promise<RootCheck> {
  const allowed = configuredScanRoots();
  if (allowed.length === 0) {
    return {
      ok: false,
      status: 403,
      error:
        'Project scanning is disabled. Set BRAIN_SCAN_ROOTS to the folder(s) that contain your projects and restart.',
    };
  }

  let realRoot: string;
  try {
    realRoot = await realpath(rootPath);
  } catch {
    return { ok: false, status: 400, error: 'Project root path does not exist or is not readable' };
  }

  for (const candidate of allowed) {
    let realAllowed: string;
    try {
      realAllowed = await realpath(candidate);
    } catch {
      continue;
    }
    if (isSafeProjectPath(realAllowed, realRoot)) {
      return { ok: true, root: realRoot };
    }
  }

  return { ok: false, status: 403, error: 'Project root is outside BRAIN_SCAN_ROOTS' };
}

export async function POST(req: NextRequest) {
  try {
    const gate = apiGuard(req, { mutation: true });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const project = getProjectById(String(body.projectId ?? ''));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!project.rootPath) {
      return NextResponse.json({ error: 'Project has no root path' }, { status: 400 });
    }

    const rootCheck = await resolveAllowedRoot(project.rootPath);
    if (!rootCheck.ok) {
      recordAuditEvent({
        projectId: project.id,
        actorType: gate.user ? 'user' : 'system',
        actorId: gate.user?.id ?? null,
        eventType: 'project.scan_rejected',
        entityType: 'Project',
        entityId: project.id,
        details: { root_path: project.rootPath, reason: rootCheck.error },
      });
      return NextResponse.json({ error: rootCheck.error }, { status: rootCheck.status });
    }

    const scan = await scanProjectFiles(rootCheck.root);
    const files = scan.files.slice(0, MAX_FILES_PER_SCAN);
    const truncatedScan = scan.files.length > files.length;

    const indexed = new Map<string, string>();
    const manifestKey = `project_scan:${project.id}`;
    const manifestRaw = getSetting(manifestKey);
    if (manifestRaw) {
      try {
        for (const [relPath, hash] of Object.entries(JSON.parse(manifestRaw) as Record<string, string>)) {
          indexed.set(relPath, hash);
        }
      } catch {
        // Ignore corrupt manifest
      }
    }

    for (const row of listItemsByProject(project.id)) {
      try {
        const m = JSON.parse(row.metadata) as { indexed_source_path?: string; indexed_content_hash?: string };
        if (m.indexed_source_path) {
          indexed.set(m.indexed_source_path, m.indexed_content_hash ?? '');
        }
      } catch {
        // Ignore malformed metadata
      }
    }

    let imported = 0;
    let unchanged = 0;
    let redactions = 0;
    let filesWithSecrets = 0;
    const skippedEmpty: string[] = [];

    for (const file of files) {
      if (indexed.get(file.relativePath) === file.hash) {
        unchanged++;
        continue;
      }

      const clipped = file.content.slice(0, MAX_CONTENT_CHARS);
      const privacy = redactSecretsInText(clipped);
      if (!privacy.text.trim()) {
        skippedEmpty.push(file.relativePath);
        continue;
      }

      redactions += privacy.redactionCount;
      if (privacy.redactionCount > 0) filesWithSecrets++;

      createItemRow({
        id: randomUUID(),
        projectId: project.id,
        title: file.relativePath,
        content: privacy.text,
        sourceApp: 'Project File Scanner',
        metadata: JSON.stringify({
          indexed_source_path: file.relativePath,
          indexed_content_hash: file.hash,
          indexed_at: new Date().toISOString(),
          provenance: 'explicit-project-scan',
          privacy_redactions: privacy.redactionCount,
          matched_rules: privacy.matchedRules,
          ...(file.content.length > MAX_CONTENT_CHARS ? { content_truncated: true } : {}),
        }),
      });
      imported++;
    }

    for (const file of files) {
      indexed.set(file.relativePath, file.hash);
    }
    upsertSetting(manifestKey, JSON.stringify(Object.fromEntries(indexed)));

    const summary = {
      root: rootCheck.root,
      imported,
      unchanged,
      skipped: scan.skipped.length + skippedEmpty.length,
      errors: scan.errors.length,
      redactions,
      files_with_secrets: filesWithSecrets,
      truncated_scan: truncatedScan,
    };

    recordAuditEvent({
      projectId: project.id,
      actorType: gate.user ? 'user' : 'system',
      actorId: gate.user?.id ?? null,
      eventType: 'project.scanned',
      entityType: 'Project',
      entityId: project.id,
      details: summary,
    });

    return NextResponse.json({
      projectId: project.id,
      rootPath: project.rootPath,
      ...summary,
      skippedFiles: [
        ...scan.skipped.slice(0, 100),
        ...skippedEmpty.slice(0, 20).map((p) => ({ path: p, reason: 'empty after redaction' })),
      ],
      errorsDetail: scan.errors.slice(0, 100),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Project scan failed' },
      { status: 500 }
    );
  }
}
