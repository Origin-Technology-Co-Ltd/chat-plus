import { t } from '../i18n/index.js';
import { getDb, type MessageRow, type ThreadRow } from '../db/init.js';
import { getSettingsLocale } from './settings.js';

export type ThreadNode = ThreadRow & {
  messages: MessageRow[];
  children: ThreadNode[];
};

export function createRootThread(sessionId: string, now = Date.now()): ThreadRow {
  const db = getDb();
  const thread: ThreadRow = {
    id: crypto.randomUUID(),
    session_id: sessionId,
    parent_thread_id: null,
    anchor_message_id: null,
    anchor_quote: null,
    include_upstream: 0,
    include_in_parent: 0,
    include_all_descendants: 0,
    title: t(getSettingsLocale(), 'thread.main'),
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO threads (
      id, session_id, parent_thread_id, anchor_message_id, anchor_quote,
      include_upstream, include_in_parent, include_all_descendants,
      title, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, NULL, 0, 0, 0, ?, ?, ?)`,
  ).run(thread.id, thread.session_id, thread.title, thread.created_at, thread.updated_at);

  return thread;
}

export function getThread(threadId: string): ThreadRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as
    | ThreadRow
    | undefined;
  return row ?? null;
}

export function getRootThread(sessionId: string): ThreadRow | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT * FROM threads WHERE session_id = ? AND parent_thread_id IS NULL LIMIT 1',
    )
    .get(sessionId) as ThreadRow | undefined;
  return row ?? null;
}

export function listThreadsForSession(sessionId: string): ThreadRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM threads WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as ThreadRow[];
}

export function getThreadMessages(
  threadId: string,
  options?: { sinceCreatedAt?: number | null },
): MessageRow[] {
  const db = getDb();
  if (options?.sinceCreatedAt) {
    return db
      .prepare(
        'SELECT * FROM messages WHERE thread_id = ? AND created_at >= ? ORDER BY created_at ASC',
      )
      .all(threadId, options.sinceCreatedAt) as MessageRow[];
  }
  return db
    .prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(threadId) as MessageRow[];
}

function titleFromQuote(quote: string): string {
  const trimmed = quote.trim().replace(/\s+/g, ' ');
  if (!trimmed) return t(getSettingsLocale(), 'thread.bypass');
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

export function createSideThread(input: {
  sessionId: string;
  parentThreadId: string;
  anchorMessageId: string;
  anchorQuote: string;
  includeUpstream: boolean;
}): ThreadRow {
  const db = getDb();
  const locale = getSettingsLocale();
  const parent = getThread(input.parentThreadId);
  if (!parent || parent.session_id !== input.sessionId) {
    throw new Error(t(locale, 'thread.parentNotFound'));
  }

  const anchor = db
    .prepare('SELECT id, thread_id, session_id FROM messages WHERE id = ?')
    .get(input.anchorMessageId) as
    | { id: string; thread_id: string; session_id: string }
    | undefined;

  if (!anchor || anchor.session_id !== input.sessionId) {
    throw new Error(t(locale, 'thread.anchorNotFound'));
  }
  if (anchor.thread_id !== input.parentThreadId) {
    throw new Error(t(locale, 'thread.anchorWrongParent'));
  }

  const now = Date.now();
  const thread: ThreadRow = {
    id: crypto.randomUUID(),
    session_id: input.sessionId,
    parent_thread_id: input.parentThreadId,
    anchor_message_id: input.anchorMessageId,
    anchor_quote: input.anchorQuote,
    include_upstream: input.includeUpstream ? 1 : 0,
    include_in_parent: 0,
    include_all_descendants: 0,
    title: titleFromQuote(input.anchorQuote),
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO threads (
      id, session_id, parent_thread_id, anchor_message_id, anchor_quote,
      include_upstream, include_in_parent, include_all_descendants,
      title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(
    thread.id,
    thread.session_id,
    thread.parent_thread_id,
    thread.anchor_message_id,
    thread.anchor_quote,
    thread.include_upstream,
    thread.title,
    thread.created_at,
    thread.updated_at,
  );

  return thread;
}

export function updateThread(
  threadId: string,
  patch: {
    includeInParent?: boolean;
    includeAllDescendants?: boolean;
    title?: string;
  },
): ThreadRow | null {
  const db = getDb();
  const current = getThread(threadId);
  if (!current) return null;

  const next: ThreadRow = {
    ...current,
    include_in_parent:
      patch.includeInParent === undefined
        ? current.include_in_parent
        : patch.includeInParent
          ? 1
          : 0,
    include_all_descendants:
      patch.includeAllDescendants === undefined
        ? current.include_all_descendants
        : patch.includeAllDescendants
          ? 1
          : 0,
    title: patch.title?.trim() ? patch.title.trim() : current.title,
    updated_at: Date.now(),
  };

  db.prepare(
    `UPDATE threads SET
      include_in_parent = ?,
      include_all_descendants = ?,
      title = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    next.include_in_parent,
    next.include_all_descendants,
    next.title,
    next.updated_at,
    threadId,
  );

  return next;
}

export function deleteThreadSubtree(threadId: string): boolean {
  const db = getDb();
  const thread = getThread(threadId);
  if (!thread) return false;
  if (thread.parent_thread_id === null) {
    throw new Error(t(getSettingsLocale(), 'thread.cannotDeleteRoot'));
  }

  // ON DELETE CASCADE removes descendants + messages with FK once thread_id FK is set.
  // Messages reference thread_id without FK historically — delete messages for subtree first.
  const all = listThreadsForSession(thread.session_id);
  const toDelete = new Set<string>();

  function collect(id: string): void {
    toDelete.add(id);
    for (const child of all) {
      if (child.parent_thread_id === id) collect(child.id);
    }
  }
  collect(threadId);

  const tx = db.transaction(() => {
    for (const id of toDelete) {
      db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id);
    }
    // delete leaves first by sorting depth descending — CASCADE on parent_thread_id helps
    const ordered = [...toDelete].sort((a, b) => {
      const depth = (id: string): number => {
        let d = 0;
        let cur = all.find((t) => t.id === id);
        while (cur?.parent_thread_id) {
          d += 1;
          cur = all.find((t) => t.id === cur!.parent_thread_id);
        }
        return d;
      };
      return depth(b) - depth(a);
    });
    for (const id of ordered) {
      db.prepare('DELETE FROM threads WHERE id = ?').run(id);
    }
  });
  tx();
  return true;
}

export function buildThreadTree(sessionId: string): ThreadNode | null {
  const threads = listThreadsForSession(sessionId);
  if (threads.length === 0) return null;

  const messagesByThread = new Map<string, MessageRow[]>();
  for (const thread of threads) {
    messagesByThread.set(thread.id, getThreadMessages(thread.id));
  }

  const nodes = new Map<string, ThreadNode>();
  for (const thread of threads) {
    nodes.set(thread.id, {
      ...thread,
      messages: messagesByThread.get(thread.id) ?? [],
      children: [],
    });
  }

  let root: ThreadNode | null = null;
  for (const thread of threads) {
    const node = nodes.get(thread.id)!;
    if (!thread.parent_thread_id) {
      root = node;
    } else {
      const parent = nodes.get(thread.parent_thread_id);
      if (parent) parent.children.push(node);
    }
  }

  return root;
}

export function listIncludedChildThreads(parent: ThreadRow, all: ThreadRow[]): ThreadRow[] {
  const direct = all.filter((t) => t.parent_thread_id === parent.id);
  if (parent.include_all_descendants) {
    const result: ThreadRow[] = [];
    function walk(id: string): void {
      for (const child of all.filter((t) => t.parent_thread_id === id)) {
        result.push(child);
        walk(child.id);
      }
    }
    walk(parent.id);
    return result;
  }

  const selected: ThreadRow[] = [];
  for (const child of direct) {
    if (!child.include_in_parent) continue;
    selected.push(child);
    // recurse with child's own include_all_descendants / include_in_parent rules
    selected.push(...listIncludedChildThreads(child, all));
  }
  return selected;
}
