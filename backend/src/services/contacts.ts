import { getDb, type ContactRow } from '../db/init.js';
import { t } from '../i18n/index.js';
import { findProfileById, getSettingsLocale } from './settings.js';

export type ContactPublic = ContactRow;

export function listContacts(): ContactPublic[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM contacts ORDER BY updated_at DESC')
    .all() as ContactPublic[];
}

export function getContact(id: string): ContactPublic | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as
    | ContactPublic
    | undefined;
  return row ?? null;
}

export function createContact(input: {
  name: string;
  modelProfileId: string;
  personalityPrompt?: string;
}): ContactPublic {
  const locale = getSettingsLocale();
  if (!findProfileById(input.modelProfileId)) {
    throw new Error(t(locale, 'profile.notFound'));
  }
  const name = input.name.trim();
  if (!name) {
    throw new Error(t(locale, 'contact.nameRequired'));
  }

  const db = getDb();
  const now = Date.now();
  const contact: ContactPublic = {
    id: crypto.randomUUID(),
    name,
    model_profile_id: input.modelProfileId,
    personality_prompt: input.personalityPrompt?.trim() ?? '',
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO contacts (id, name, model_profile_id, personality_prompt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    contact.id,
    contact.name,
    contact.model_profile_id,
    contact.personality_prompt,
    contact.created_at,
    contact.updated_at,
  );

  return contact;
}

export function updateContact(
  id: string,
  patch: {
    name?: string;
    modelProfileId?: string;
    personalityPrompt?: string;
  },
): ContactPublic | null {
  const locale = getSettingsLocale();
  const current = getContact(id);
  if (!current) return null;

  if (patch.modelProfileId && !findProfileById(patch.modelProfileId)) {
    throw new Error(t(locale, 'profile.notFound'));
  }

  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  if (!name) {
    throw new Error(t(locale, 'contact.nameRequired'));
  }

  const next: ContactPublic = {
    ...current,
    name,
    model_profile_id: patch.modelProfileId ?? current.model_profile_id,
    personality_prompt:
      patch.personalityPrompt !== undefined
        ? patch.personalityPrompt.trim()
        : current.personality_prompt,
    updated_at: Date.now(),
  };

  getDb()
    .prepare(
      `UPDATE contacts SET name = ?, model_profile_id = ?, personality_prompt = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.name,
      next.model_profile_id,
      next.personality_prompt,
      next.updated_at,
      id,
    );

  return next;
}

export function countRoomsUsingContact(contactId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM session_members sm
       INNER JOIN sessions s ON s.id = sm.session_id
       WHERE sm.contact_id = ? AND s.kind = 'room'`,
    )
    .get(contactId) as { c: number };
  return row.c;
}

export function deleteContact(id: string): boolean {
  const locale = getSettingsLocale();
  if (!getContact(id)) return false;
  if (countRoomsUsingContact(id) > 0) {
    throw new Error(t(locale, 'contact.inUse'));
  }
  const result = getDb().prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return result.changes > 0;
}
