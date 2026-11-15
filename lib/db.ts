// S6 + A1: Single SQLite database adapter using Node.js built-in node:sqlite.
// Query logging is OFF by default so captured notes/secrets never leak into logs.
// Set BRAIN_PRISMA_LOG_QUERIES=1 temporarily only when debugging SQL.

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

interface SqliteStatement {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
}

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
}

const req = createRequire(import.meta.url);

function loadDatabaseSync(): new (location: string) => SqliteDatabase {
  const mod = req('node:sqlite') as { DatabaseSync: new (location: string) => SqliteDatabase };
  return mod.DatabaseSync;
}

export function resolveSqliteFilePath(): string {
  const raw = (process.env.DATABASE_URL || 'file:./db/custom.db').trim();
  const stripped = raw.startsWith('file:') ? raw.slice(5) : raw;
  return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped);
}

function shouldLogQueries(): boolean {
  return process.env.BRAIN_PRISMA_LOG_QUERIES === '1';
}

function logQuery(sql: string) {
  if (shouldLogQueries()) {
    console.debug(`[sql] ${sql.replace(/\s+/g, ' ').trim()}`);
  }
}

const globalForDb = globalThis as unknown as {
  __cortexDb?: SqliteDatabase;
  __cortexDbPath?: string;
};

function ensureSchema(conn: SqliteDatabase) {
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS UserAccount (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL,
      lastLoginAt TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Project (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL,
      rootPath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Item (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sourceApp TEXT NOT NULL,
      metadata TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS BrainAsset (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      filePath TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      ocrText TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS AuditEvent (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      actorType TEXT NOT NULL,
      actorId TEXT,
      eventType TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      details TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
}

export function getDb(): SqliteDatabase {
  const filePath = resolveSqliteFilePath();
  if (globalForDb.__cortexDb && globalForDb.__cortexDbPath === filePath) {
    return globalForDb.__cortexDb;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  const DatabaseSync = loadDatabaseSync();
  const conn = new DatabaseSync(filePath);
  ensureSchema(conn);
  globalForDb.__cortexDb = conn;
  globalForDb.__cortexDbPath = filePath;
  return conn;
}

export function getSetting(key: string): string | null {
  const sql = 'SELECT value FROM Setting WHERE key = ?';
  logQuery(sql);
  const row = getDb().prepare(sql).get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function upsertSetting(key: string, value: string): void {
  const sql =
    'INSERT INTO Setting (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt';
  logQuery(sql);
  getDb().prepare(sql).run(key, value, new Date().toISOString());
}

export function deleteSetting(key: string): void {
  const sql = 'DELETE FROM Setting WHERE key = ?';
  logQuery(sql);
  getDb().prepare(sql).run(key);
}

export function readAllSettings(): Record<string, string> {
  const sql = 'SELECT key, value FROM Setting';
  logQuery(sql);
  const rows = getDb().prepare(sql).all() as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export interface UserAccountRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export function countUserAccounts(): number {
  const sql = 'SELECT COUNT(*) AS cnt FROM UserAccount';
  logQuery(sql);
  const row = getDb().prepare(sql).get() as { cnt?: number } | undefined;
  return Number(row?.cnt ?? 0);
}

export function createUserAccount(user: Omit<UserAccountRow, 'createdAt'>): UserAccountRow {
  const createdAt = new Date().toISOString();
  const sql =
    'INSERT INTO UserAccount (id, email, name, passwordHash, role, lastLoginAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)';
  logQuery(sql);
  getDb()
    .prepare(sql)
    .run(user.id, user.email, user.name, user.passwordHash, user.role, user.lastLoginAt, createdAt);
  return { ...user, createdAt };
}

export function findUserByEmail(email: string): UserAccountRow | null {
  const sql = 'SELECT id, email, name, passwordHash, role, lastLoginAt, createdAt FROM UserAccount WHERE email = ?';
  logQuery(sql);
  const row = getDb().prepare(sql).get(email.toLowerCase()) as UserAccountRow | undefined;
  return row ?? null;
}

export function findFirstOwner(): UserAccountRow | null {
  const sql =
    "SELECT id, email, name, passwordHash, role, lastLoginAt, createdAt FROM UserAccount WHERE role = 'owner' ORDER BY createdAt ASC LIMIT 1";
  logQuery(sql);
  const row = getDb().prepare(sql).get() as UserAccountRow | undefined;
  return row ?? null;
}

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export function listProjects(): ProjectRow[] {
  const sql = 'SELECT id, name, slug, description, rootPath, createdAt, updatedAt FROM Project ORDER BY createdAt DESC';
  logQuery(sql);
  return getDb().prepare(sql).all() as unknown as ProjectRow[];
}

export function getProjectById(id: string): ProjectRow | null {
  const sql = 'SELECT id, name, slug, description, rootPath, createdAt, updatedAt FROM Project WHERE id = ?';
  logQuery(sql);
  const row = getDb().prepare(sql).get(id) as ProjectRow | undefined;
  return row ?? null;
}

export function createProjectRow(p: Omit<ProjectRow, 'createdAt' | 'updatedAt'>): ProjectRow {
  const now = new Date().toISOString();
  const sql =
    'INSERT INTO Project (id, name, slug, description, rootPath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)';
  logQuery(sql);
  getDb().prepare(sql).run(p.id, p.name, p.slug, p.description, p.rootPath, now, now);
  return { ...p, createdAt: now, updatedAt: now };
}

export interface ItemRow {
  id: string;
  projectId: string | null;
  title: string;
  content: string;
  sourceApp: string;
  metadata: string;
  createdAt: string;
}

export function createItemRow(item: Omit<ItemRow, 'createdAt'>): ItemRow {
  const createdAt = new Date().toISOString();
  const sql =
    'INSERT INTO Item (id, projectId, title, content, sourceApp, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)';
  logQuery(sql);
  getDb()
    .prepare(sql)
    .run(item.id, item.projectId, item.title, item.content, item.sourceApp, item.metadata, createdAt);
  return { ...item, createdAt };
}

export function listItemsByProject(projectId: string): ItemRow[] {
  const sql = 'SELECT id, projectId, title, content, sourceApp, metadata, createdAt FROM Item WHERE projectId = ?';
  logQuery(sql);
  return getDb().prepare(sql).all(projectId) as unknown as ItemRow[];
}

export function searchItems(query: string): ItemRow[] {
  const q = `%${query}%`;
  const sql =
    'SELECT id, projectId, title, content, sourceApp, metadata, createdAt FROM Item WHERE title LIKE ? OR content LIKE ? ORDER BY createdAt DESC LIMIT 50';
  logQuery(sql);
  return getDb().prepare(sql).all(q, q) as unknown as ItemRow[];
}

export function listAllItems(limit = 500): ItemRow[] {
  const sql = 'SELECT id, projectId, title, content, sourceApp, metadata, createdAt FROM Item ORDER BY id ASC LIMIT ?';
  logQuery(sql);
  return getDb().prepare(sql).all(limit) as unknown as ItemRow[];
}

export function updateItemContent(id: string, content: string): void {
  const sql = 'UPDATE Item SET content = ? WHERE id = ?';
  logQuery(sql);
  getDb().prepare(sql).run(content, id);
}

export interface BrainAssetRow {
  id: string;
  projectId: string | null;
  filePath: string;
  mimeType: string;
  ocrText: string;
  createdAt: string;
}

export function createBrainAssetRow(asset: Omit<BrainAssetRow, 'createdAt'>): BrainAssetRow {
  const createdAt = new Date().toISOString();
  const sql =
    'INSERT INTO BrainAsset (id, projectId, filePath, mimeType, ocrText, createdAt) VALUES (?, ?, ?, ?, ?, ?)';
  logQuery(sql);
  getDb()
    .prepare(sql)
    .run(asset.id, asset.projectId, asset.filePath, asset.mimeType, asset.ocrText, createdAt);
  return { ...asset, createdAt };
}

export function listBrainAssets(limit = 500): BrainAssetRow[] {
  const sql = 'SELECT id, projectId, filePath, mimeType, ocrText, createdAt FROM BrainAsset ORDER BY id ASC LIMIT ?';
  logQuery(sql);
  return getDb().prepare(sql).all(limit) as unknown as BrainAssetRow[];
}

export function updateBrainAssetOcr(id: string, ocrText: string): void {
  const sql = 'UPDATE BrainAsset SET ocrText = ? WHERE id = ?';
  logQuery(sql);
  getDb().prepare(sql).run(ocrText, id);
}

export interface AuditEventRow {
  id: string;
  projectId: string | null;
  actorType: string;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export function recordAuditEvent(input: {
  projectId?: string | null;
  actorType: string;
  actorId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}): void {
  try {
    const sql =
      'INSERT INTO AuditEvent (id, projectId, actorType, actorId, eventType, entityType, entityId, details, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    logQuery(sql);
    getDb()
      .prepare(sql)
      .run(
        `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input.projectId ?? null,
        input.actorType,
        input.actorId ?? null,
        input.eventType,
        input.entityType,
        input.entityId,
        JSON.stringify(input.details ?? {}),
        new Date().toISOString()
      );
  } catch {
    // Audit writes must never crash the main request
  }
}

export function listAuditEvents(limit = 100): AuditEventRow[] {
  const sql =
    'SELECT id, projectId, actorType, actorId, eventType, entityType, entityId, details, createdAt FROM AuditEvent ORDER BY createdAt DESC LIMIT ?';
  logQuery(sql);
  return getDb().prepare(sql).all(limit) as unknown as AuditEventRow[];
}
