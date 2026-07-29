import { t } from '../i18n';
import { isTauriRuntime, resolveApiUrl } from '../lib/runtime';

export type Session = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  model_profile_id: string | null;
};

export type Message = {
  id: string;
  session_id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
  model_profile_id?: string | null;
  model_label?: string | null;
};

export type Thread = {
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
  messages: Message[];
  children: Thread[];
};

export type SessionDetail = Session & {
  messages: Message[];
  rootThreadId: string;
  threadTree: Thread;
};

export type ModelProfilePublic = {
  id: string;
  name: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  baseUrl: string;
  model: string;
};

export type Settings = {
  baseUrl: string;
  model: string;
  exportDir: string;
  exportAskEachTime: boolean;
  contextWindow: number;
  contextAutoTrim: boolean;
  contextKeepRounds: number;
  contextTargetRatio: number;
  /** null until first bootstrap write */
  locale: 'en' | 'zh' | null;
  apiKeyMasked: string;
  hasApiKey: boolean;
  profiles: ModelProfilePublic[];
  defaultProfileId: string;
};

export type ProfileInput = {
  id?: string;
  name: string;
  apiKey?: string;
  baseUrl: string;
  model: string;
};

export type ContextSnapshot = {
  fullTokens: number;
  sentTokens: number;
  window: number;
  ratio: number;
  trimmed: boolean;
  keepRounds: number;
  autoTrim: boolean;
  includedMessageIds: string[];
  overBudget?: boolean;
  threadId?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  context?: ContextSnapshot;

  constructor(
    message: string,
    options: { status: number; code?: string; context?: ContextSnapshot },
  ) {
    super(message);
    this.status = options.status;
    this.code = options.code;
    this.context = options.context;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithDesktopRetry(input: string, init?: RequestInit): Promise<Response> {
  const attempts = isTauriRuntime() ? 20 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (!isTauriRuntime() || attempt === attempts - 1) {
        throw error;
      }
      await sleep(250);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const response = await fetchWithDesktopRetry(resolveApiUrl(path), {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      code?: string;
      message?: string;
      context?: ContextSnapshot;
    } | null;
    const message =
      typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : t('api.requestFailed', { status: response.status });
    throw new ApiError(message, {
      status: response.status,
      code: body?.code ?? (typeof body?.error === 'string' ? body.error : undefined),
      context: body?.context,
    });
  }

  return response.json() as Promise<T>;
}

export function fetchSessions(): Promise<Session[]> {
  return request('/api/sessions');
}

export function createSession(): Promise<Session> {
  return request('/api/sessions', { method: 'POST', body: '{}' });
}

export function fetchSession(id: string): Promise<SessionDetail> {
  return request(`/api/sessions/${id}`);
}

export function fetchSessionContext(
  id: string,
  threadId?: string,
): Promise<ContextSnapshot> {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : '';
  return request(`/api/sessions/${id}/context${query}`);
}

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return request(`/api/sessions/${id}`, { method: 'DELETE' });
}

export function createThread(
  sessionId: string,
  input: {
    parentThreadId: string;
    anchorMessageId: string;
    anchorQuote: string;
    includeUpstream: boolean;
  },
): Promise<Thread> {
  return request(`/api/sessions/${sessionId}/threads`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchThread(
  threadId: string,
  input: {
    includeInParent?: boolean;
    includeAllDescendants?: boolean;
    title?: string;
  },
): Promise<Thread> {
  return request(`/api/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteThread(threadId: string): Promise<{ ok: boolean }> {
  return request(`/api/threads/${threadId}`, { method: 'DELETE' });
}

export function fetchSettings(): Promise<Settings> {
  return request('/api/settings');
}

export function updateSettings(
  input: Partial<
    Omit<Settings, 'profiles' | 'apiKeyMasked' | 'hasApiKey' | 'locale'> & {
      apiKey?: string;
      profiles?: ProfileInput[];
      defaultProfileId?: string;
      locale?: 'en' | 'zh';
    }
  >,
): Promise<Settings> {
  return request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function patchSession(
  id: string,
  input: { title?: string; model_profile_id?: string | null },
): Promise<Session> {
  return request(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function exportSession(id: string, path?: string): Promise<{ path: string }> {
  return request(`/api/sessions/${id}/export`, {
    method: 'POST',
    body: JSON.stringify(path ? { path } : {}),
  });
}

export async function streamChat(
  sessionId: string,
  content: string,
  onDelta: (delta: string) => void,
  options?: { threadId?: string; allowCompress?: boolean },
): Promise<{ messageId: string; content: string; context?: ContextSnapshot }> {
  const response = await fetchWithDesktopRetry(resolveApiUrl(`/api/sessions/${sessionId}/chat`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      threadId: options?.threadId,
      allowCompress: options?.allowCompress,
    }),
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
      message?: string;
      context?: ContextSnapshot;
    } | null;
    throw new ApiError(body?.message ?? body?.error ?? t('api.chatRequestFailed'), {
      status: response.status,
      code: body?.code ?? body?.error,
      context: body?.context,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let messageId = '';
  let context: ContextSnapshot | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event.split('\n').find((entry) => entry.startsWith('data: '));
      if (!line) continue;

      const payload = JSON.parse(line.slice(6)) as {
        type: string;
        content?: string;
        message?: string;
        messageId?: string;
        context?: ContextSnapshot;
      };

      if (payload.type === 'delta' && payload.content) {
        fullContent += payload.content;
        onDelta(payload.content);
      } else if (payload.type === 'done') {
        messageId = payload.messageId ?? '';
        if (payload.content) fullContent = payload.content;
        context = payload.context;
      } else if (payload.type === 'error') {
        throw new Error(payload.message ?? t('api.chatFailed'));
      }
    }
  }

  return { messageId, content: fullContent, context };
}

/** Find thread node by id in tree. */
export function findThread(root: Thread, id: string): Thread | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findThread(child, id);
    if (found) return found;
  }
  return null;
}

/** Path from root to target thread (inclusive). */
export function pathToThread(root: Thread, targetId: string): Thread[] | null {
  if (root.id === targetId) return [root];
  for (const child of root.children) {
    const sub = pathToThread(child, targetId);
    if (sub) return [root, ...sub];
  }
  return null;
}

export function siblingsOf(root: Thread, threadId: string): Thread[] {
  const path = pathToThread(root, threadId);
  if (!path || path.length === 0) return [root];
  if (path.length === 1) return [root];
  const parent = path[path.length - 2];
  return parent.children;
}

/**
 * Walk `startId` downward using remembered parent→child preferences
 * (e.g. restore B→C after switching away to sibling D).
 */
export function deepestPreferredThread(
  root: Thread,
  startId: string,
  preferredChildByParent: Record<string, string>,
): string {
  const start = findThread(root, startId);
  if (!start) return startId;

  let cursorId = start.id;
  const visited = new Set<string>();

  while (!visited.has(cursorId)) {
    visited.add(cursorId);
    const node = findThread(root, cursorId);
    if (!node) break;

    const preferredId: string | undefined = preferredChildByParent[node.id];
    if (!preferredId) break;
    if (!node.children.some((child) => child.id === preferredId)) break;
    cursorId = preferredId;
  }

  return cursorId;
}

/** Visible columns: path to focus, then keep appending preferred/first child. */
export function buildDisplayPath(
  root: Thread,
  focusedId: string,
  preferredChildByParent: Record<string, string>,
): Thread[] {
  const base = pathToThread(root, focusedId) ?? [root];
  const path = [...base];
  const visited = new Set(path.map((node) => node.id));

  let last = path[path.length - 1];
  while (last.children.length > 0) {
    const preferredId = preferredChildByParent[last.id];
    const next =
      (preferredId
        ? last.children.find((child) => child.id === preferredId)
        : undefined) ?? last.children[0];
    if (!next || visited.has(next.id)) break;
    path.push(next);
    visited.add(next.id);
    last = next;
  }

  return path;
}
