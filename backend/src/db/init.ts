import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDataDir } from '../lib/paths.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function tableHasColumn(
  database: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return cols.some((col) => col.name === column);
}

function ensureThreadsSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_thread_id TEXT,
      anchor_message_id TEXT,
      anchor_quote TEXT,
      include_upstream INTEGER NOT NULL DEFAULT 0,
      include_in_parent INTEGER NOT NULL DEFAULT 0,
      include_all_descendants INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id);
    CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_thread_id);
  `);

  if (!tableHasColumn(database, 'messages', 'thread_id')) {
    database.exec(`ALTER TABLE messages ADD COLUMN thread_id TEXT`);
  }

  // Backfill: every session gets exactly one root thread; orphan messages attach to it.
  const sessions = database.prepare('SELECT id, created_at, updated_at FROM sessions').all() as Array<{
    id: string;
    created_at: number;
    updated_at: number;
  }>;

  const findRoot = database.prepare(
    'SELECT id FROM threads WHERE session_id = ? AND parent_thread_id IS NULL LIMIT 1',
  );
  const insertRoot = database.prepare(
    `INSERT INTO threads (
      id, session_id, parent_thread_id, anchor_message_id, anchor_quote,
      include_upstream, include_in_parent, include_all_descendants,
      title, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, NULL, 0, 0, 0, ?, ?, ?)`,
  );
  const attachMessages = database.prepare(
    'UPDATE messages SET thread_id = ? WHERE session_id = ? AND (thread_id IS NULL OR thread_id = \'\')',
  );

  const tx = database.transaction(() => {
    for (const session of sessions) {
      const root = findRoot.get(session.id) as { id: string } | undefined;
      let rootId = root?.id;
      if (!rootId) {
        rootId = crypto.randomUUID();
        insertRoot.run(
          rootId,
          session.id,
          '主对话',
          session.created_at,
          session.updated_at,
        );
      }
      attachMessages.run(rootId, session.id);
    }
  });
  tx();

  // Enforce NOT NULL going forward via app writes; older SQLite may lack easy ALTER NOT NULL.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  `);
}

function ensureModelProfileColumns(database: Database.Database): void {
  if (!tableHasColumn(database, 'sessions', 'model_profile_id')) {
    database.exec(`ALTER TABLE sessions ADD COLUMN model_profile_id TEXT`);
  }
  if (!tableHasColumn(database, 'messages', 'model_profile_id')) {
    database.exec(`ALTER TABLE messages ADD COLUMN model_profile_id TEXT`);
  }
  if (!tableHasColumn(database, 'messages', 'model_label')) {
    database.exec(`ALTER TABLE messages ADD COLUMN model_label TEXT`);
  }
}

export function initDb(): Database.Database {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'chatplus.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  ensureThreadsSchema(db);
  ensureModelProfileColumns(db);

  return db;
}

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  model_profile_id: string | null;
};

export type ThreadRow = {
  id: string;
  session_id: string;
  parent_thread_id: string | null;
  anchor_message_id: string | null;
  anchor_quote: string | null;
  include_upstream: number;
  include_in_parent: number;
  include_all_descendants: number;
  title: string;
  created_at: number;
  updated_at: number;
};

export type MessageRow = {
  id: string;
  session_id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
  model_profile_id: string | null;
  model_label: string | null;
};
