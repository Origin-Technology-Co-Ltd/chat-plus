import { isDefaultSessionTitle, t } from '../i18n/index.js';
import { getDb, type MessageRow, type SessionRow } from '../db/init.js';
import { getSettingsLocale } from './settings.js';
import { buildThreadTree, createRootThread, type ThreadNode } from './threads.js';

export type SessionWithMessages = SessionRow & { messages: MessageRow[] };

export type SessionDetail = SessionRow & {
  /** Flat messages for backward compatibility (root thread only). */
  messages: MessageRow[];
  rootThreadId: string;
  threadTree: ThreadNode;
};

function mapSessionRow(row: SessionRow): SessionRow {
  return {
    ...row,
    model_profile_id: row.model_profile_id ?? null,
  };
}

export function listSessions(): SessionRow[] {
  const db = getDb();
  return (db
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all() as SessionRow[]).map(mapSessionRow);
}

export function createSession(title?: string): SessionRow {
  const resolvedTitle = title?.trim() || t(getSettingsLocale(), 'session.newChat');
  const db = getDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  const session: SessionRow = {
    id,
    title: resolvedTitle,
    created_at: now,
    updated_at: now,
    model_profile_id: null,
  };

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO sessions (id, title, created_at, updated_at, model_profile_id) VALUES (?, ?, ?, ?, ?)',
    ).run(
      session.id,
      session.title,
      session.created_at,
      session.updated_at,
      session.model_profile_id,
    );
    createRootThread(session.id, now);
  });
  tx();

  return session;
}

export function getSession(sessionId: string): SessionDetail | null {
  const db = getDb();
  const session = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;

  if (!session) return null;
  const mapped = mapSessionRow(session);

  const tree = buildThreadTree(sessionId);
  if (!tree) {
    // Should not happen after backfill; heal by creating root.
    createRootThread(sessionId);
    const healed = buildThreadTree(sessionId);
    if (!healed) return null;
    return {
      ...mapped,
      messages: healed.messages,
      rootThreadId: healed.id,
      threadTree: healed,
    };
  }

  return {
    ...mapped,
    messages: tree.messages,
    rootThreadId: tree.id,
    threadTree: tree,
  };
}

export function updateSession(
  sessionId: string,
  patch: { title?: string; model_profile_id?: string | null },
): SessionRow | null {
  const db = getDb();
  const current = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;
  if (!current) return null;

  const now = Date.now();
  const title = patch.title ?? current.title;
  const modelProfileId =
    patch.model_profile_id !== undefined
      ? patch.model_profile_id
      : (current.model_profile_id ?? null);

  db.prepare(
    'UPDATE sessions SET title = ?, model_profile_id = ?, updated_at = ? WHERE id = ?',
  ).run(title, modelProfileId, now, sessionId);

  return mapSessionRow(
    db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow,
  );
}

export function updateSessionTitle(sessionId: string, title: string): SessionRow | null {
  return updateSession(sessionId, { title });
}

export function touchSession(sessionId: string): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);
}

export function deleteSession(sessionId: string): boolean {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM threads WHERE session_id = ?').run(sessionId);
    return db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });
  return tx().changes > 0;
}

export function insertMessage(input: {
  sessionId: string;
  threadId: string;
  role: MessageRow['role'];
  content: string;
  modelProfileId?: string | null;
  modelLabel?: string | null;
}): MessageRow {
  const db = getDb();
  const message: MessageRow = {
    id: crypto.randomUUID(),
    session_id: input.sessionId,
    thread_id: input.threadId,
    role: input.role,
    content: input.content,
    created_at: Date.now(),
    model_profile_id:
      input.role === 'assistant' ? (input.modelProfileId ?? null) : null,
    model_label: input.role === 'assistant' ? (input.modelLabel ?? null) : null,
  };

  db.prepare(
    `INSERT INTO messages (
      id, session_id, thread_id, role, content, created_at, model_profile_id, model_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.session_id,
    message.thread_id,
    message.role,
    message.content,
    message.created_at,
    message.model_profile_id,
    message.model_label,
  );

  touchSession(input.sessionId);
  db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(
    Date.now(),
    input.threadId,
  );
  return message;
}

export function maybeAutoTitleSession(sessionId: string, userContent: string): void {
  const db = getDb();
  const session = db
    .prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string } | undefined;

  if (!session || !isDefaultSessionTitle(session.title)) return;

  const trimmed = userContent.trim().replace(/\s+/g, ' ');
  const title =
    trimmed.length > 30
      ? `${trimmed.slice(0, 30)}…`
      : trimmed || t(getSettingsLocale(), 'session.newChat');
  updateSessionTitle(sessionId, title);
}

export function getSessionMessages(sessionId: string): MessageRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as MessageRow[];
}
