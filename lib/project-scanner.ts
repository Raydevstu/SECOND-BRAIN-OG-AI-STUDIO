// S2 + S3: Safe project path containment and text file scanning.

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const MAX_FILE_BYTES = 512 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.test', 'dist', 'build', 'db']);
const SKIP_SECRET_FILES = /^\.env($|\.)|\.pem$|\.key$/i;
const ALLOWED_EXT = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.yaml',
  '.yml',
  '.py',
  '.sql',
  '.prisma',
]);

export function isSafeProjectPath(allowedRoot: string, candidatePath: string): boolean {
  const rel = path.relative(allowedRoot, candidatePath);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  content: string;
  hash: string;
}

export interface ProjectScanResult {
  files: ScannedFile[];
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: string }>;
}

export async function scanProjectFiles(realRoot: string): Promise<ProjectScanResult> {
  const files: ScannedFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(realRoot, fullPath);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped.push({ path: relPath, reason: 'ignored directory' });
          continue;
        }
        try {
          const resolvedDir = await realpath(fullPath);
          if (!isSafeProjectPath(realRoot, resolvedDir)) {
            skipped.push({ path: relPath, reason: 'symlink escapes root' });
            continue;
          }
          await walk(resolvedDir);
        } catch (err) {
          errors.push({ path: relPath, error: err instanceof Error ? err.message : 'dir error' });
        }
        continue;
      }

      if (SKIP_SECRET_FILES.test(entry.name)) {
        skipped.push({ path: relPath, reason: 'secret filename skipped' });
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        skipped.push({ path: relPath, reason: 'unsupported extension' });
        continue;
      }

      try {
        const resolvedFile = await realpath(fullPath);
        if (!isSafeProjectPath(realRoot, resolvedFile)) {
          skipped.push({ path: relPath, reason: 'symlink escapes root' });
          continue;
        }
        const info = await stat(resolvedFile);
        if (info.size > MAX_FILE_BYTES) {
          skipped.push({ path: relPath, reason: 'exceeds 512KB' });
          continue;
        }
        const content = await readFile(resolvedFile, 'utf8');
        const hash = createHash('sha256').update(content).digest('hex');
        files.push({ relativePath: relPath, absolutePath: resolvedFile, content, hash });
      } catch (err) {
        errors.push({ path: relPath, error: err instanceof Error ? err.message : 'read error' });
      }
    }
  }

  await walk(realRoot);
  return { files, skipped, errors };
}
