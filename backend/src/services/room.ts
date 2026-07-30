import { getDb, type ContactRow, type MessageRow } from '../db/init.js';
import { getContact } from './contacts.js';

export function listSessionMembers(sessionId: string): ContactRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.* FROM session_members sm
       INNER JOIN contacts c ON c.id = sm.contact_id
       WHERE sm.session_id = ?
       ORDER BY sm.sort_order ASC, c.name ASC`,
    )
    .all(sessionId) as ContactRow[];
}

export function setSessionMembers(sessionId: string, contactIds: string[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_members WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      'INSERT INTO session_members (session_id, contact_id, sort_order) VALUES (?, ?, ?)',
    );
    contactIds.forEach((contactId, index) => {
      insert.run(sessionId, contactId, index);
    });
  });
  tx();
}

export function isRoomMember(sessionId: string, contactId: string): boolean {
  const row = getDb()
    .prepare(
      'SELECT 1 AS ok FROM session_members WHERE session_id = ? AND contact_id = ? LIMIT 1',
    )
    .get(sessionId, contactId) as { ok: number } | undefined;
  return Boolean(row);
}

export function getMessageById(messageId: string): MessageRow | null {
  const row = getDb()
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(messageId) as MessageRow | undefined;
  return row
    ? {
        ...row,
        contact_id: row.contact_id ?? null,
        target_contact_id: row.target_contact_id ?? null,
        reply_to_message_id: row.reply_to_message_id ?? null,
        model_profile_id: row.model_profile_id ?? null,
        model_label: row.model_label ?? null,
      }
    : null;
}

/**
 * Resolve who should reply in a room.
 * Priority: @ mention → quote chain → latest conversation partner.
 */
export function resolveRoomTarget(input: {
  sessionId: string;
  mentionContactId?: string | null;
  replyToMessageId?: string | null;
  /** When false, skip falling back to latest conversation AI. Default true. */
  allowDefaultTarget?: boolean;
}): string | null {
  const memberIds = new Set(listSessionMembers(input.sessionId).map((c) => c.id));

  if (input.mentionContactId) {
    return memberIds.has(input.mentionContactId) ? input.mentionContactId : null;
  }

  let cursor = input.replyToMessageId ?? null;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const message = getMessageById(cursor);
    if (!message || message.session_id !== input.sessionId) break;

    if (message.role === 'assistant' && message.contact_id && memberIds.has(message.contact_id)) {
      return message.contact_id;
    }
    if (
      message.role === 'user' &&
      message.target_contact_id &&
      memberIds.has(message.target_contact_id)
    ) {
      return message.target_contact_id;
    }
    cursor = message.reply_to_message_id;
  }

  if (input.allowDefaultTarget === false) return null;
  return latestConversationContactId(input.sessionId, memberIds);
}

/** Most recent AI (or user-targeted AI) still in the room. */
export function latestConversationContactId(
  sessionId: string,
  memberIds?: Set<string>,
): string | null {
  const members = memberIds ?? new Set(listSessionMembers(sessionId).map((c) => c.id));
  if (members.size === 0) return null;

  const rows = getDb()
    .prepare(
      `SELECT role, contact_id, target_contact_id FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 80`,
    )
    .all(sessionId) as Array<{
    role: string;
    contact_id: string | null;
    target_contact_id: string | null;
  }>;

  for (const row of rows) {
    if (row.role === 'assistant' && row.contact_id && members.has(row.contact_id)) {
      return row.contact_id;
    }
    if (row.role === 'user' && row.target_contact_id && members.has(row.target_contact_id)) {
      return row.target_contact_id;
    }
  }
  return null;
}

export function requireRoomContact(contactId: string): ContactRow {
  const contact = getContact(contactId);
  if (!contact) {
    throw new Error('Contact not found');
  }
  return contact;
}
