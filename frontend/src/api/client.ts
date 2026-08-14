import { t } from '../i18n';
import { isTauriRuntime, resolveApiUrl } from '../lib/runtime';

export type RoomMode = 'specified' | 'meeting';
export type MeetingStatus = 'inactive' | 'active' | 'ended';
export type HostType = 'user' | 'ai';
export type SpeakerType = 'user' | 'contact';
export type MessageKind = 'chat' | 'summary' | 'confirm_ask' | 'confirm_answer';

export type MeetingConfirmOption = {
  id: string;
  label: string;
};

export type MeetingPendingConfirm = {
  id: string;
  title: string;
  prompt: string;
  options: MeetingConfirmOption[];
  allowRating: boolean;
  createdAt: number;
};

export function parseMeetingPendingConfirm(raw: unknown): MeetingPendingConfirm | null {
  let value = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const options = Array.isArray(rec.options)
    ? rec.options
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null;
          const opt = item as Record<string, unknown>;
          const label = typeof opt.label === 'string' ? opt.label.trim() : '';
          if (!label) return null;
          return {
            id: typeof opt.id === 'string' && opt.id.trim() ? opt.id.trim() : `opt-${index}`,
            label,
          };
        })
        .filter((item): item is MeetingConfirmOption => Boolean(item))
    : [];
  if (options.length < 2) return null;
  const title = typeof rec.title === 'string' ? rec.title.trim() : '';
  const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim() : '';
  if (!title || !prompt) return null;
  return {
    id: typeof rec.id === 'string' ? rec.id : '',
    title,
    prompt,
    options,
    allowRating: rec.allowRating !== false,
    createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0,
  };
}

export type Session = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  model_profile_id: string | null;
  kind: 'chat' | 'room';
  room_mode: RoomMode;
  meeting_goal: string | null;
  meeting_status: MeetingStatus;
  host_type: HostType | null;
  host_contact_id: string | null;
  next_speaker_type: SpeakerType | null;
  next_speaker_contact_id: string | null;
  meeting_round_count: number;
  meeting_max_rounds: number;
  meeting_auto_paused: number;
  meeting_started_at: number | null;
  meeting_max_minutes: number;
  meeting_speak_gap_sec: number;
  meeting_continue_history: number;
  meeting_pending_confirm: string | MeetingPendingConfirm | null;
};

export type Contact = {
  id: string;
  name: string;
  model_profile_id: string;
  personality_prompt: string;
  created_at: number;
  updated_at: number;
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
  contact_id?: string | null;
  target_contact_id?: string | null;
  reply_to_message_id?: string | null;
  kind?: MessageKind;
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
  members: Contact[];
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

export function createSession(input?: {
  title?: string;
  kind?: 'chat' | 'room';
  memberContactIds?: string[];
}): Promise<Session> {
  return request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
}

export function fetchContacts(): Promise<Contact[]> {
  return request('/api/contacts');
}

export function createContact(input: {
  name: string;
  modelProfileId: string;
  personalityPrompt?: string;
}): Promise<Contact> {
  return request('/api/contacts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateContact(
  id: string,
  input: {
    name?: string;
    modelProfileId?: string;
    personalityPrompt?: string;
  },
): Promise<Contact> {
  return request(`/api/contacts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteContact(id: string): Promise<{ ok: boolean }> {
  return request(`/api/contacts/${id}`, { method: 'DELETE' });
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
  input: {
    title?: string;
    model_profile_id?: string | null;
    memberContactIds?: string[];
    returnToSpecified?: boolean;
    endMeeting?: boolean;
    startMeeting?: {
      goal: string;
      hostType: HostType;
      hostContactId?: string;
      maxRounds?: number;
      maxMinutes?: number;
      speakGapSec?: number;
      continueHistory?: boolean;
    };
    pauseMeeting?: boolean;
    meetingSpeakGapSec?: number;
  },
): Promise<SessionDetail> {
  return request(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function assignMeetingSpeaker(
  sessionId: string,
  input: { nextSpeakerType: SpeakerType; contactId?: string },
): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}/meeting/assign`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function resumeMeeting(sessionId: string): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}/meeting/resume`, {
    method: 'POST',
  });
}

export function pauseMeeting(sessionId: string): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pauseMeeting: true }),
  });
}

export function askMeetingConfirm(
  sessionId: string,
  input: {
    title: string;
    prompt: string;
    options: Array<{ id?: string; label: string }>;
    allowRating?: boolean;
  },
): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}/meeting/confirm/ask`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function submitMeetingConfirm(
  sessionId: string,
  input: {
    selectedIds: string[];
    ratings?: Record<string, number>;
    comment?: string;
  },
): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}/meeting/confirm`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

function parseChatSseEvents(buffer: string): {
  events: string[];
  rest: string;
} {
  const events = buffer.split('\n\n');
  const rest = events.pop() ?? '';
  return { events, rest };
}

function applyChatSsePayload(
  payload: {
    type: string;
    content?: string;
    message?: string;
    messageId?: string;
    context?: ContextSnapshot;
    noop?: boolean;
    reason?: string;
    nextSpeakerType?: SpeakerType;
    nextSpeakerContactId?: string | null;
    contactId?: string | null;
    createdAt?: number;
  },
  state: {
    onDelta: (delta: string) => void;
    meeting: MeetingStreamMeta;
    fullContent: { value: string };
    messageId: { value: string };
    context: { value: ContextSnapshot | undefined };
    noop: { value: boolean };
  },
): void {
  if (payload.type === 'delta' && payload.content) {
    state.fullContent.value += payload.content;
    state.onDelta(payload.content);
  } else if (payload.type === 'noop') {
    state.noop.value = true;
  } else if (payload.type === 'meeting_await_assign') {
    state.meeting.awaitAssign = true;
  } else if (payload.type === 'meeting_ended') {
    state.meeting.ended = true;
    state.meeting.endReason = payload.reason;
  } else if (payload.type === 'meeting_assign') {
    state.meeting.assign = {
      nextSpeakerType: payload.nextSpeakerType ?? 'user',
      nextSpeakerContactId: payload.nextSpeakerContactId ?? null,
      reason: typeof payload.reason === 'string' ? payload.reason : '',
    };
  } else if (payload.type === 'meeting_host_message' && payload.content) {
    state.meeting.hostMessage = {
      id: payload.messageId ?? `host-${Date.now()}`,
      content: payload.content,
      contactId: payload.contactId ?? null,
      createdAt: payload.createdAt,
    };
  } else if (payload.type === 'done') {
    state.messageId.value = payload.messageId ?? '';
    if (payload.content) state.fullContent.value = payload.content;
    state.context.value = payload.context;
    if (payload.noop) state.noop.value = true;
  } else if (payload.type === 'error') {
    throw new Error(payload.message ?? t('api.chatFailed'));
  }
}

async function readChatSse(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<{
  messageId: string;
  content: string;
  context?: ContextSnapshot;
  noop?: boolean;
  meeting?: MeetingStreamMeta;
}> {
  if (!response.body) {
    throw new ApiError(t('api.chatRequestFailed'), { status: response.status });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const fullContent = { value: '' };
  const messageId = { value: '' };
  const context = { value: undefined as ContextSnapshot | undefined };
  const noop = { value: false };
  const meeting: MeetingStreamMeta = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseChatSseEvents(buffer);
    buffer = rest;

    for (const event of events) {
      const line = event.split('\n').find((entry) => entry.startsWith('data: '));
      if (!line) continue;
      applyChatSsePayload(JSON.parse(line.slice(6)), {
        onDelta,
        meeting,
        fullContent,
        messageId,
        context,
        noop,
      });
    }
  }

  return {
    messageId: messageId.value,
    content: fullContent.value,
    context: context.value,
    noop: noop.value,
    meeting,
  };
}

export function exportSession(id: string, path?: string): Promise<{ path: string }> {
  return request(`/api/sessions/${id}/export`, {
    method: 'POST',
    body: JSON.stringify(path ? { path } : {}),
  });
}

export type MeetingStreamMeta = {
  awaitAssign?: boolean;
  ended?: boolean;
  endReason?: string;
  assign?: {
    nextSpeakerType: SpeakerType;
    nextSpeakerContactId?: string | null;
    reason?: string;
  };
  hostMessage?: {
    id: string;
    content: string;
    contactId?: string | null;
    createdAt?: number;
  };
};

export async function streamChat(
  sessionId: string,
  content: string,
  onDelta: (delta: string) => void,
  options?: {
    threadId?: string;
    allowCompress?: boolean;
    mentionContactId?: string;
    replyToMessageId?: string;
    allowDefaultTarget?: boolean;
  },
): Promise<{
  messageId: string;
  content: string;
  context?: ContextSnapshot;
  noop?: boolean;
  meeting?: MeetingStreamMeta;
}> {
  const response = await fetchWithDesktopRetry(resolveApiUrl(`/api/sessions/${sessionId}/chat`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      threadId: options?.threadId,
      allowCompress: options?.allowCompress,
      mentionContactId: options?.mentionContactId,
      replyToMessageId: options?.replyToMessageId,
      allowDefaultTarget: options?.allowDefaultTarget,
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

  return readChatSse(response, onDelta);
}

export async function streamMeetingSpeak(
  sessionId: string,
  onDelta: (delta: string) => void,
  options?: { afterHostAssign?: boolean },
): Promise<{
  messageId: string;
  content: string;
  context?: ContextSnapshot;
  meeting?: MeetingStreamMeta;
}> {
  const query = options?.afterHostAssign ? '?afterHostAssign=1' : '';
  const response = await fetchWithDesktopRetry(
    resolveApiUrl(`/api/sessions/${sessionId}/meeting/speak${query}`),
    { method: 'POST' },
  );

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
      message?: string;
    } | null;
    throw new ApiError(body?.message ?? body?.error ?? t('api.chatRequestFailed'), {
      status: response.status,
      code: body?.code ?? body?.error,
    });
  }

  return readChatSse(response, onDelta);
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
