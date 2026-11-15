// scripts/redact-legacy-ocr.ts — A6: redact legacy secrets stored in BrainAsset.ocrText and Item.content.
//
//   bun scripts/redact-legacy-ocr.ts           dry run: reports affected rows only
//   bun scripts/redact-legacy-ocr.ts --apply   writes the redacted text
//
// Back up the database first. Uses DATABASE_URL. Never prints secrets.

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { redactSecretsInText } from '../lib/privacy-redactor';

const req = createRequire(import.meta.url);
const { DatabaseSync } = req('node:sqlite') as {
  DatabaseSync: new (location: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      all: (...params: unknown[]) => Array<Record<string, unknown>>;
      run: (...params: unknown[]) => unknown;
    };
    close: () => void;
  };
};

const APPLY = process.argv.includes('--apply');
const BATCH = 200;

function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL || 'file:./db/custom.db').trim();
  const stripped = raw.startsWith('file:') ? raw.slice(5) : raw;
  return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped);
}

function main() {
  const dbPath = resolveDbPath();
  console.log(`redact-legacy-ocr — ${APPLY ? 'APPLY' : 'dry run'} — DB=${dbPath}`);
  if (!existsSync(dbPath)) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    console.log('Database file does not exist yet; 0 asset(s) scanned, 0 item(s) scanned.');
    return;
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS BrainAsset (id TEXT PRIMARY KEY, projectId TEXT, filePath TEXT NOT NULL, mimeType TEXT NOT NULL, ocrText TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS Item (id TEXT PRIMARY KEY, projectId TEXT, title TEXT NOT NULL, content TEXT NOT NULL, sourceApp TEXT NOT NULL, metadata TEXT NOT NULL, createdAt TEXT NOT NULL);
    `);

    let scannedAssets = 0;
    let affectedAssets = 0;
    let updatedAssets = 0;
    let cursor = '';

    for (;;) {
      const rows = db
        .prepare('SELECT id, ocrText FROM BrainAsset WHERE id > ? ORDER BY id ASC LIMIT ?')
        .all(cursor, BATCH) as Array<{ id: string; ocrText: string }>;
      if (rows.length === 0) break;

      for (const row of rows) {
        scannedAssets++;
        const original = row.ocrText ?? '';
        if (!original) continue;
        const redacted = redactSecretsInText(original).text;
        if (redacted === original) continue;
        affectedAssets++;
        console.log(`  BrainAsset ${row.id}: ${original.length} → ${redacted.length} chars`);
        if (APPLY) {
          db.prepare('UPDATE BrainAsset SET ocrText = ? WHERE id = ?').run(redacted, row.id);
          updatedAssets++;
        }
      }
      cursor = rows[rows.length - 1].id;
    }

    let scannedItems = 0;
    let affectedItems = 0;
    let updatedItems = 0;
    cursor = '';

    for (;;) {
      const rows = db
        .prepare('SELECT id, content FROM Item WHERE id > ? ORDER BY id ASC LIMIT ?')
        .all(cursor, BATCH) as Array<{ id: string; content: string }>;
      if (rows.length === 0) break;

      for (const row of rows) {
        scannedItems++;
        const original = row.content ?? '';
        if (!original) continue;
        const redacted = redactSecretsInText(original).text;
        if (redacted === original) continue;
        affectedItems++;
        console.log(`  Item ${row.id}: ${original.length} → ${redacted.length} chars`);
        if (APPLY) {
          db.prepare('UPDATE Item SET content = ? WHERE id = ?').run(redacted, row.id);
          updatedItems++;
        }
      }
      cursor = rows[rows.length - 1].id;
    }

    console.log(
      `\nscanned ${scannedAssets} asset(s) (${affectedAssets} with secrets, ${APPLY ? `${updatedAssets} updated` : 'dry-run'}) & ${scannedItems} item(s) (${affectedItems} with secrets, ${APPLY ? `${updatedItems} updated` : 'dry-run'})`
    );
  } finally {
    db.close();
  }
}

main();
