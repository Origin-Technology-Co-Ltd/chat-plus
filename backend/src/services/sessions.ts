import { isDefaultSessionTitle, t } from '../i18n/index.js';
import {
  getDb,
  type MessageRow,
  type SessionKind,
  type SessionRow,
} from '../db/init.js';
import { getContact } from './contacts.js';
import { listSessionMembers, setSessionMembers } from './room.js';
import { getSettingsLocale } from './settings.js';
import { buildThreadTree, createRootThread, type ThreadNode } from './threads.js';
import type { ContactRow } from '../db/init.js';

export type SessionWithMessages = SessionRow & { messages: MessageRow[] };

export type SessionDetail = SessionRow & {
  messages: MessageRow[];
  rootThreadId: string;
  threadTree: ThreadNode;
  members: ContactRow[];
};

function mapMessageRow(row: MessageRow): MessageRow {
  return {
    ...row,
    model_profile_id: row.model_profile_id ?? null,
    model_label: row.model_label ?? null,
    contact_id: row.contact_id ?? null,
    target_contact_id: row.target_contact_id ?? null,
    reply_to_message_id: row.reply_to_message_id ?? null,
  };
}

function mapSessionRow(row: SessionRow): SessionRow {
  return {
    ...row,
    model_profile_id: row.model_profile_id ?? null,
    kind: (row.kind === 'room' ? 'room' : 'chat') as SessionKind,
  };
}

export function listSessions(): SessionRow[] {
  const db = getDb();
  return (db
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all() as SessionRow[]).map(mapSessionRow);
}

export function createSession(input?: {
  title?: string;
  kind?: SessionKind;
  memberContactIds?: string[];
}): SessionRow {
  const kind: SessionKind = input?.kind === 'room' ? 'room' : 'chat';
  const locale = getSettingsLocale();
  const resolvedTitle =
    input?.title?.trim() ||
    t(locale, kind === 'room' ? 'session.newRoom' : 'session.newChat');

  if (kind === 'room') {
    const ids = [...new Set(input?.memberContactIds ?? [])];
    if (ids.length < 2) {
      throw new Error(t(locale, 'room.needTwoMembers'));
    }
    for (const id of ids) {
      if (!getContact(id)) {
        throw new Error(t(locale, 'contact.notFound'));
      }
    }
  }

  const db = getDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  const session: SessionRow = {
    id,
    title: resolvedTitle,
    created_at: now,
    updated_at: now,
    model_profile_id: null,
    kind,
  };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at, model_profile_id, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id,
      session.title,
      session.created_at,
      session.updated_at,
      session.model_profile_id,
      session.kind,
    );
    createRootThread(session.id, now);
    if (kind === 'room' && input?.memberContactIds) {
      setSessionMembers(session.id, [...new Set(input.memberContactIds)]);
    }
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
  const members = mapped.kind === 'room' ? listSessionMembers(sessionId) : [];

  const tree = buildThreadTree(sessionId);
  if (!tree) {
    createRootThread(sessionId);
    const healed = buildThreadTree(sessionId);
    if (!healed) return null;
    return {
      ...mapped,
      messages: healed.messages.map(mapMessageRow),
      rootThreadId: healed.id,
      threadTree: healed,
      members,
    };
  }

  return {
    ...mapped,
    messages: tree.messages.map(mapMessageRow),
    rootThreadId: tree.id,
    threadTree: mapThreadMessages(tree),
    members,
  };
}

function mapThreadMessages(node: ThreadNode): ThreadNode {
  return {
    ...node,
    messages: node.messages.map(mapMessageRow),
    children: node.children.map(mapThreadMessages),
  };
}

export function updateSession(
  sessionId: string,
  patch: {
    title?: string;
    model_profile_id?: string | null;
    memberContactIds?: string[];
  },
): SessionRow | null {
  const db = getDb();
  const locale = getSettingsLocale();
  const current = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;
  if (!current) return null;
  const mapped = mapSessionRow(current);

  if (patch.memberContactIds !== undefined) {
    if (mapped.kind !== 'room') {
      throw new Error(t(locale, 'room.notARoom'));
    }
    const ids = [...new Set(patch.memberContactIds)];
    if (ids.length < 2) {
      throw new Error(t(locale, 'room.needTwoMembers'));
    }
    for (const id of ids) {
      if (!getContact(id)) {
        throw new Error(t(locale, 'contact.notFound'));
      }
    }
    setSessionMembers(sessionId, ids);
  }

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
    db.prepare('DELETE FROM session_members WHERE session_id = ?').run(sessionId);
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
  contactId?: string | null;
  targetContactId?: string | null;
  replyToMessageId?: string | null;
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
    contact_id:
      input.role === 'assistant' ? (input.contactId ?? null) : null,
    target_contact_id:
      input.role === 'user' ? (input.targetContactId ?? null) : null,
    reply_to_message_id: input.replyToMessageId ?? null,
  };

  db.prepare(
    `INSERT INTO messages (
      id, session_id, thread_id, role, content, created_at,
      model_profile_id, model_label, contact_id, target_contact_id, reply_to_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.session_id,
    message.thread_id,
    message.role,
    message.content,
    message.created_at,
    message.model_profile_id,
    message.model_label,
    message.contact_id,
    message.target_contact_id,
    message.reply_to_message_id,
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
  return (db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as MessageRow[]).map(mapMessageRow);
}
