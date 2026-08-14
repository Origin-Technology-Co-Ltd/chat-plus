import {
  getDb,
  type ContactRow,
  type HostType,
  type MeetingStatus,
  type MessageKind,
  type MessageRow,
  type SessionRow,
  type SpeakerType,
} from '../db/init.js';
import { chatCompletion } from '../lib/openai-client.js';
import { t } from '../i18n/index.js';
import {
  assertProfileConfigured,
  findProfileById,
  getSettingsLocale,
  profileLabel,
} from './settings.js';
import {
  clearMeetingSpeakRate,
  resumeMeetingAuto,
} from './meetingRateLimit.js';
import { listSessionMembers } from './room.js';
import { getRootThread } from './threads.js';

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

export type MeetingConfirmReply = {
  selectedIds: string[];
  ratings?: Record<string, number>;
  comment?: string;
};

export type MeetingAssignment = {
  nextSpeakerType: SpeakerType;
  nextSpeakerContactId: string | null;
  reason: string;
  shouldEnd: boolean;
  endReason: string | null;
  askConfirm?: MeetingPendingConfirm | null;
  hostMessage?: MessageRow | null;
  summaryMessage?: MessageRow | null;
};

export function parsePendingConfirm(raw: unknown): MeetingPendingConfirm | null {
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
          if (typeof item === 'string' && item.trim()) {
            return { id: `opt-${index}`, label: item.trim().slice(0, 200) };
          }
          if (!item || typeof item !== 'object') return null;
          const opt = item as Record<string, unknown>;
          const label = typeof opt.label === 'string' ? opt.label.trim() : '';
          if (!label) return null;
          return {
            id: typeof opt.id === 'string' && opt.id.trim() ? opt.id.trim() : `opt-${index}`,
            label: label.slice(0, 200),
          };
        })
        .filter((item): item is MeetingConfirmOption => Boolean(item))
    : [];
  if (options.length < 2) return null;
  const title = typeof rec.title === 'string' ? rec.title.trim() : '';
  const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim() : '';
  if (!title || !prompt) return null;
  return {
    id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : crypto.randomUUID(),
    title: title.slice(0, 120),
    prompt: prompt.slice(0, 500),
    options: options.slice(0, 6),
    allowRating: rec.allowRating !== false && rec.allow_rating !== false,
    createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
  };
}

export function isMeetingActive(session: SessionRow): boolean {
  return session.kind === 'room' && session.room_mode === 'meeting' && session.meeting_status === 'active';
}

export function mapMeetingFields(row: Record<string, unknown>): Pick<
  SessionRow,
  | 'room_mode'
  | 'meeting_goal'
  | 'meeting_status'
  | 'host_type'
  | 'host_contact_id'
  | 'next_speaker_type'
  | 'next_speaker_contact_id'
  | 'meeting_round_count'
  | 'meeting_max_rounds'
  | 'meeting_auto_paused'
  | 'meeting_started_at'
  | 'meeting_max_minutes'
  | 'meeting_speak_gap_sec'
  | 'meeting_continue_history'
  | 'meeting_pending_confirm'
> {
  return {
    room_mode: row.room_mode === 'meeting' ? 'meeting' : 'specified',
    meeting_goal: typeof row.meeting_goal === 'string' ? row.meeting_goal : null,
    meeting_status:
      row.meeting_status === 'active' || row.meeting_status === 'ended'
        ? row.meeting_status
        : 'inactive',
    host_type: row.host_type === 'user' || row.host_type === 'ai' ? row.host_type : null,
    host_contact_id:
      typeof row.host_contact_id === 'string' ? row.host_contact_id : null,
    next_speaker_type:
      row.next_speaker_type === 'user' || row.next_speaker_type === 'contact'
        ? row.next_speaker_type
        : null,
    next_speaker_contact_id:
      typeof row.next_speaker_contact_id === 'string' ? row.next_speaker_contact_id : null,
    meeting_round_count:
      typeof row.meeting_round_count === 'number' ? row.meeting_round_count : 0,
    meeting_max_rounds:
      typeof row.meeting_max_rounds === 'number' ? row.meeting_max_rounds : 30,
    meeting_auto_paused: row.meeting_auto_paused ? 1 : 0,
    meeting_started_at:
      typeof row.meeting_started_at === 'number' ? row.meeting_started_at : null,
    meeting_max_minutes:
      typeof row.meeting_max_minutes === 'number' ? row.meeting_max_minutes : 0,
    meeting_speak_gap_sec:
      typeof row.meeting_speak_gap_sec === 'number' ? row.meeting_speak_gap_sec : 8,
    meeting_continue_history: row.meeting_continue_history === 0 ? 0 : 1,
    meeting_pending_confirm:
      typeof row.meeting_pending_confirm === 'string' && row.meeting_pending_confirm.trim()
        ? row.meeting_pending_confirm
        : null,
  };
}

export function startMeeting(
  sessionId: string,
  input: {
    meetingGoal: string;
    hostType: HostType;
    hostContactId?: string | null;
    meetingMaxRounds?: number;
    meetingMaxMinutes?: number;
    meetingSpeakGapSec?: number;
    meetingContinueHistory?: boolean;
  },
): SessionRow {
  const locale = getSettingsLocale();
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
    | Record<string, unknown>
    | undefined;
  if (!session || session.kind !== 'room') {
    throw new Error(t(locale, 'room.notARoom'));
  }

  const members = listSessionMembers(sessionId);
  if (members.length < 2) {
    throw new Error(t(locale, 'meeting.needTwoMembers'));
  }

  const goal = input.meetingGoal.trim();
  if (!goal) {
    throw new Error(t(locale, 'meeting.goalRequired'));
  }

  if (input.hostType === 'ai') {
    if (!input.hostContactId || !members.some((m) => m.id === input.hostContactId)) {
      throw new Error(t(locale, 'meeting.hostMustBeMember'));
    }
  }

  const maxRounds = Math.max(0, input.meetingMaxRounds ?? 30);
  const maxMinutes = Math.max(0, input.meetingMaxMinutes ?? 0);
  const speakGapSec = Math.min(120, Math.max(2, input.meetingSpeakGapSec ?? 8));
  const continueHistory = input.meetingContinueHistory === false ? 0 : 1;
  const now = Date.now();

  db.prepare(
    `UPDATE sessions SET
      room_mode = 'meeting',
      meeting_goal = ?,
      meeting_status = 'active',
      host_type = ?,
      host_contact_id = ?,
      next_speaker_type = NULL,
      next_speaker_contact_id = NULL,
      meeting_round_count = 0,
      meeting_max_rounds = ?,
      meeting_auto_paused = 0,
      meeting_started_at = ?,
      meeting_max_minutes = ?,
      meeting_speak_gap_sec = ?,
      meeting_continue_history = ?,
      meeting_pending_confirm = NULL,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    goal,
    input.hostType,
    input.hostType === 'ai' ? (input.hostContactId ?? null) : null,
    maxRounds,
    now,
    maxMinutes,
    speakGapSec,
    continueHistory,
    now,
    sessionId,
  );

  clearMeetingSpeakRate(sessionId);
  resumeMeetingAuto(sessionId);

  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
}

/**
 * Called right after startMeeting to kick off the first assignment.
 * For AI host: calls LLM to pick first speaker.
 * For user host: emits await_assign so frontend shows picker.
 */
export async function kickoffMeeting(
  sessionId: string,
): Promise<MeetingAssignment | 'await_user'> {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
  if (!isMeetingActive(session)) return 'await_user';

  if (session.host_type === 'ai') {
    return runAiHostAssignment(sessionId);
  }
  return 'await_user';
}

export function endMeeting(sessionId: string, status: MeetingStatus = 'ended'): void {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET meeting_status = ?, next_speaker_type = NULL, next_speaker_contact_id = NULL, updated_at = ? WHERE id = ?`,
  ).run(status, Date.now(), sessionId);
}

export function returnToSpecifiedMode(sessionId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET
      room_mode = 'specified',
      meeting_status = 'inactive',
      meeting_goal = NULL,
      host_type = NULL,
      host_contact_id = NULL,
      next_speaker_type = NULL,
      next_speaker_contact_id = NULL,
      meeting_round_count = 0,
      meeting_auto_paused = 0,
      meeting_started_at = NULL,
      meeting_max_minutes = 0,
      meeting_speak_gap_sec = 8,
      meeting_continue_history = 1,
      meeting_pending_confirm = NULL,
      updated_at = ?
     WHERE id = ?`,
  ).run(Date.now(), sessionId);
  clearMeetingSpeakRate(sessionId);
}

export function clearNextSpeaker(sessionId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET next_speaker_type = NULL, next_speaker_contact_id = NULL, updated_at = ? WHERE id = ?`,
  ).run(Date.now(), sessionId);
}

export function assignNextSpeaker(
  sessionId: string,
  input: { nextSpeakerType: SpeakerType; contactId?: string | null },
): void {
  const locale = getSettingsLocale();
  const members = listSessionMembers(sessionId);
  const memberIds = new Set(members.map((m) => m.id));

  if (input.nextSpeakerType === 'contact') {
    if (!input.contactId || !memberIds.has(input.contactId)) {
      throw new Error(t(locale, 'room.memberNotFound'));
    }
  }

  const db = getDb();
  db.prepare(
    `UPDATE sessions SET
      next_speaker_type = ?,
      next_speaker_contact_id = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    input.nextSpeakerType,
    input.nextSpeakerType === 'contact' ? (input.contactId ?? null) : null,
    Date.now(),
    sessionId,
  );
}

export function incrementMeetingRound(sessionId: string): SessionRow {
  const db = getDb();
  db.prepare(
    'UPDATE sessions SET meeting_round_count = meeting_round_count + 1, updated_at = ? WHERE id = ?',
  ).run(Date.now(), sessionId);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
}

export function shouldAutoEndMeeting(session: SessionRow): boolean {
  if (session.meeting_max_rounds > 0 && session.meeting_round_count >= session.meeting_max_rounds) {
    return true;
  }
  if (session.meeting_max_minutes > 0 && session.meeting_started_at) {
    return Date.now() - session.meeting_started_at >= session.meeting_max_minutes * 60_000;
  }
  return false;
}

export function updateMeetingSpeakGap(sessionId: string, seconds: number): void {
  const gap = Math.min(120, Math.max(2, Math.round(seconds)));
  getDb()
    .prepare('UPDATE sessions SET meeting_speak_gap_sec = ?, updated_at = ? WHERE id = ?')
    .run(gap, Date.now(), sessionId);
}

/**
 * Meeting target: @ → quote chain → assigned next_speaker (contact only).
 */
export function resolveMeetingTarget(input: {
  session: SessionRow;
  mentionContactId?: string | null;
  replyToMessageId?: string | null;
  memberIds: Set<string>;
  resolveQuote: (replyToMessageId: string | null | undefined) => string | null;
}): string | null {
  if (input.mentionContactId && input.memberIds.has(input.mentionContactId)) {
    return input.mentionContactId;
  }

  if (input.replyToMessageId) {
    const fromQuote = input.resolveQuote(input.replyToMessageId);
    if (fromQuote) return fromQuote;
  }

  if (
    input.session.next_speaker_type === 'contact' &&
    input.session.next_speaker_contact_id &&
    input.memberIds.has(input.session.next_speaker_contact_id)
  ) {
    return input.session.next_speaker_contact_id;
  }

  return null;
}

export function resolveMemberRef(
  ref: string | null | undefined,
  members: ContactRow[],
): ContactRow | null {
  if (!ref?.trim()) return null;
  const trimmed = ref.trim().replace(/^@/, '');
  const byId = members.find((m) => m.id === trimmed);
  if (byId) return byId;
  const lower = trimmed.toLowerCase();
  const exact = members.filter((m) => m.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = members.filter(
    (m) => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()),
  );
  return partial.length === 1 ? partial[0] : null;
}

/** First @member in text, longest name wins. */
export function findMentionedMembers(
  text: string,
  members: ContactRow[],
  excludeId?: string | null,
): ContactRow[] {
  if (!text) return [];
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  const found: ContactRow[] = [];
  const seen = new Set<string>();
  for (const member of sorted) {
    if (excludeId && member.id === excludeId) continue;
    if (text.includes(`@${member.name}`) && !seen.has(member.id)) {
      seen.add(member.id);
      found.push(member);
    }
  }
  return found;
}

function formatMemberBrief(members: ContactRow[]): string {
  return members
    .map((m) => {
      const prompt = m.personality_prompt.trim();
      return prompt
        ? `- ${m.name} (id=${m.id}): ${prompt.slice(0, 200)}`
        : `- ${m.name} (id=${m.id})`;
    })
    .join('\n');
}

export function formatHostAssignmentContent(
  assignment: MeetingAssignment,
  members: ContactRow[],
): string {
  const locale = getSettingsLocale();
  const reason = assignment.endReason?.trim() || assignment.reason.trim();
  if (assignment.shouldEnd) {
    return t(locale, 'meeting.hostSayEnd', { reason });
  }
  if (assignment.nextSpeakerType === 'contact' && assignment.nextSpeakerContactId) {
    const name =
      members.find((m) => m.id === assignment.nextSpeakerContactId)?.name ?? '?';
    return t(locale, 'meeting.hostSayContact', { name, reason });
  }
  return t(locale, 'meeting.hostSayUser', { reason });
}

export function insertMeetingVisibleMessage(input: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  contactId?: string | null;
  targetContactId?: string | null;
  modelProfileId?: string | null;
  modelLabel?: string | null;
  kind?: MessageKind;
}): MessageRow | null {
  const thread = getRootThread(input.sessionId);
  if (!thread || !input.content.trim()) return null;

  const kind: MessageKind =
    input.kind === 'summary' || input.kind === 'confirm_ask' || input.kind === 'confirm_answer'
      ? input.kind
      : 'chat';

  const message: MessageRow = {
    id: crypto.randomUUID(),
    session_id: input.sessionId,
    thread_id: thread.id,
    role: input.role,
    content: input.content.trim(),
    created_at: Date.now(),
    model_profile_id: input.role === 'assistant' ? (input.modelProfileId ?? null) : null,
    model_label: input.role === 'assistant' ? (input.modelLabel ?? null) : null,
    contact_id: input.role === 'assistant' ? (input.contactId ?? null) : null,
    target_contact_id: input.role === 'user' ? (input.targetContactId ?? null) : null,
    reply_to_message_id: null,
    kind,
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO messages (
      id, session_id, thread_id, role, content, created_at,
      model_profile_id, model_label, contact_id, target_contact_id, reply_to_message_id, kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    message.kind,
  );
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), input.sessionId);
  db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(Date.now(), thread.id);
  return message;
}

export function insertAiHostAssignmentMessage(
  sessionId: string,
  hostContactId: string,
  assignment: MeetingAssignment,
): MessageRow | null {
  const members = listSessionMembers(sessionId);
  const host = members.find((m) => m.id === hostContactId);
  const found = host ? findProfileById(host.model_profile_id) : null;
  return insertMeetingVisibleMessage({
    sessionId,
    role: 'assistant',
    content: formatHostAssignmentContent(assignment, members),
    contactId: hostContactId,
    modelProfileId: found?.id ?? null,
    modelLabel: found ? profileLabel(found) : null,
  });
}

function parseAskConfirm(raw: unknown): MeetingPendingConfirm | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  return parsePendingConfirm({
    title: rec.title,
    prompt: rec.prompt ?? rec.question ?? rec.reason,
    options: rec.options,
    allowRating: rec.allow_rating ?? rec.allowRating,
    allow_rating: rec.allow_rating ?? rec.allowRating,
  });
}

function parseHostJson(raw: string): MeetingAssignment {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Invalid host response');
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    next_speaker_type?: string;
    next_speaker_contact_id?: string | null;
    next_speaker_name?: string | null;
    reason?: string;
    should_end?: boolean;
    end_reason?: string | null;
    ask_confirm?: unknown;
  };

  const askConfirm = parseAskConfirm(parsed.ask_confirm);
  const nextSpeakerType: SpeakerType = askConfirm
    ? 'user'
    : parsed.next_speaker_type === 'contact'
      ? 'contact'
      : 'user';

  return {
    nextSpeakerType,
    nextSpeakerContactId: askConfirm
      ? null
      : typeof parsed.next_speaker_contact_id === 'string'
        ? parsed.next_speaker_contact_id
        : typeof parsed.next_speaker_name === 'string'
          ? parsed.next_speaker_name
          : null,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    shouldEnd: Boolean(parsed.should_end) && !askConfirm,
    endReason: typeof parsed.end_reason === 'string' ? parsed.end_reason : null,
    askConfirm,
  };
}

function meetingHistoryText(sessionId: string, session: SessionRow, members: ContactRow[]): string {
  const continueHistory = session.meeting_continue_history !== 0;
  const since =
    !continueHistory && typeof session.meeting_started_at === 'number'
      ? session.meeting_started_at
      : null;
  const rows = (
    since
      ? (getDb()
          .prepare(
            'SELECT * FROM messages WHERE session_id = ? AND created_at >= ? ORDER BY created_at ASC',
          )
          .all(sessionId, since) as MessageRow[])
      : (getDb()
          .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
          .all(sessionId) as MessageRow[])
  ).slice(-32);
  return rows
    .map((m) => {
      const who =
        m.role === 'user'
          ? 'User'
          : members.find((c) => c.id === m.contact_id)?.name ?? 'Assistant';
      return `${who}: ${m.content.slice(0, 500)}`;
    })
    .join('\n');
}

export function getPendingConfirm(sessionId: string): MeetingPendingConfirm | null {
  const row = getDb()
    .prepare('SELECT meeting_pending_confirm FROM sessions WHERE id = ?')
    .get(sessionId) as { meeting_pending_confirm?: string | null } | undefined;
  return parsePendingConfirm(row?.meeting_pending_confirm);
}

export function clearPendingConfirm(sessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET meeting_pending_confirm = NULL, updated_at = ? WHERE id = ?')
    .run(Date.now(), sessionId);
}

function savePendingConfirm(sessionId: string, confirm: MeetingPendingConfirm): void {
  getDb()
    .prepare('UPDATE sessions SET meeting_pending_confirm = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(confirm), Date.now(), sessionId);
}

function formatConfirmAskContent(confirm: MeetingPendingConfirm): string {
  const locale = getSettingsLocale();
  const options = confirm.options.map((opt, index) => `${index + 1}. ${opt.label}`).join('\n');
  return t(locale, 'meeting.confirmAskSay', {
    title: confirm.title,
    prompt: confirm.prompt,
    options,
  });
}

function formatConfirmAnswerContent(
  confirm: MeetingPendingConfirm,
  reply: MeetingConfirmReply,
): string {
  const locale = getSettingsLocale();
  const selected = confirm.options
    .filter((opt) => reply.selectedIds.includes(opt.id))
    .map((opt) => {
      const rating = reply.ratings?.[opt.id];
      return typeof rating === 'number'
        ? `${opt.label} (${rating}/5)`
        : opt.label;
    })
    .join('；');
  const comment = reply.comment?.trim() ?? '';
  return t(locale, 'meeting.confirmAnswerSay', {
    title: confirm.title,
    selected: selected || '-',
    comment: comment || '-',
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
): MeetingPendingConfirm {
  const locale = getSettingsLocale();
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
    | SessionRow
    | undefined;
  if (!session || !isMeetingActive(session)) {
    throw new Error(t(locale, 'meeting.notActive'));
  }
  const confirm = parsePendingConfirm({
    id: crypto.randomUUID(),
    title: input.title,
    prompt: input.prompt,
    options: input.options,
    allowRating: input.allowRating !== false,
    createdAt: Date.now(),
  });
  if (!confirm) {
    throw new Error(t(locale, 'meeting.confirmNeedTwoOptions'));
  }

  savePendingConfirm(sessionId, confirm);
  assignNextSpeaker(sessionId, { nextSpeakerType: 'user', contactId: null });

  const host = session.host_contact_id
    ? listSessionMembers(sessionId).find((m) => m.id === session.host_contact_id)
    : null;
  const found = host ? findProfileById(host.model_profile_id) : null;
  insertMeetingVisibleMessage({
    sessionId,
    role: host ? 'assistant' : 'user',
    content: formatConfirmAskContent(confirm),
    contactId: host?.id ?? null,
    modelProfileId: found?.id ?? null,
    modelLabel: found ? profileLabel(found) : null,
    kind: 'confirm_ask',
  });
  return confirm;
}

export function submitMeetingConfirm(
  sessionId: string,
  reply: MeetingConfirmReply,
): { confirm: MeetingPendingConfirm; message: MessageRow | null } {
  const locale = getSettingsLocale();
  const session = getDb()
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;
  if (!session || !isMeetingActive(session)) {
    throw new Error(t(locale, 'meeting.notActive'));
  }
  const pending = parsePendingConfirm(session.meeting_pending_confirm);
  if (!pending) {
    throw new Error(t(locale, 'meeting.confirmNotPending'));
  }
  const validIds = new Set(pending.options.map((opt) => opt.id));
  const selectedIds = [...new Set(reply.selectedIds.filter((id) => validIds.has(id)))];
  if (selectedIds.length === 0) {
    throw new Error(t(locale, 'meeting.confirmInvalidChoice'));
  }
  const ratings: Record<string, number> = {};
  for (const [id, value] of Object.entries(reply.ratings ?? {})) {
    if (!validIds.has(id)) continue;
    const n = Math.round(Number(value));
    if (n >= 1 && n <= 5) ratings[id] = n;
  }
  const normalized: MeetingConfirmReply = {
    selectedIds,
    ratings: Object.keys(ratings).length ? ratings : undefined,
    comment: reply.comment?.trim() || undefined,
  };
  const message = insertMeetingVisibleMessage({
    sessionId,
    role: 'user',
    content: formatConfirmAnswerContent(pending, normalized),
    kind: 'confirm_answer',
  });
  clearPendingConfirm(sessionId);
  resumeMeetingAuto(sessionId);
  clearNextSpeaker(sessionId);
  return { confirm: pending, message };
}

async function generateMeetingSummary(sessionId: string, reason?: string | null): Promise<MessageRow | null> {
  const locale = getSettingsLocale();
  const session = getDb()
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;
  if (!session) return null;
  const members = listSessionMembers(sessionId);
  const host =
    session.host_type === 'ai' && session.host_contact_id
      ? members.find((m) => m.id === session.host_contact_id) ?? null
      : null;
  const speaker = host ?? members[0] ?? null;
  if (!speaker) return null;
  const found = findProfileById(speaker.model_profile_id);
  if (!found) return null;
  let profile;
  try {
    profile = assertProfileConfigured(found);
  } catch {
    return insertMeetingVisibleMessage({
      sessionId,
      role: 'assistant',
      content: t(locale, 'meeting.summaryFallback', { reason: reason?.trim() || '-' }),
      contactId: speaker.id,
      modelProfileId: found.id,
      modelLabel: profileLabel(found),
      kind: 'summary',
    });
  }

  const historyText = meetingHistoryText(sessionId, session, members);
  let summary = '';
  try {
    summary = await chatCompletion({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      messages: [
        {
          role: 'system',
          content: t(locale, 'meeting.summarySystem', { goal: session.meeting_goal ?? '' }),
        },
        {
          role: 'user',
          content: t(locale, 'meeting.summaryUser', {
            reason: reason?.trim() || '-',
            transcript: historyText || t(locale, 'assemble.emptyTranscript'),
          }),
        },
      ],
    });
  } catch {
    summary = t(locale, 'meeting.summaryFallback', { reason: reason?.trim() || '-' });
  }
  return insertMeetingVisibleMessage({
    sessionId,
    role: 'assistant',
    content: summary.trim() || t(locale, 'meeting.summaryFallback', { reason: reason?.trim() || '-' }),
    contactId: speaker.id,
    modelProfileId: profile.id,
    modelLabel: profileLabel(profile),
    kind: 'summary',
  });
}

export async function finalizeMeeting(
  sessionId: string,
  reason?: string | null,
): Promise<MessageRow | null> {
  clearPendingConfirm(sessionId);
  const summary = await generateMeetingSummary(sessionId, reason);
  endMeeting(sessionId, 'ended');
  return summary;
}

export async function runAiHostAssignment(sessionId: string): Promise<MeetingAssignment> {
  const locale = getSettingsLocale();
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
    | SessionRow
    | undefined;
  if (!session || !isMeetingActive(session)) {
    throw new Error(t(locale, 'meeting.notActive'));
  }
  if (session.host_type !== 'ai' || !session.host_contact_id) {
    throw new Error(t(locale, 'meeting.notAiHost'));
  }

  const members = listSessionMembers(sessionId);
  const host = members.find((m) => m.id === session.host_contact_id);
  if (!host) {
    throw new Error(t(locale, 'meeting.hostMustBeMember'));
  }

  const found = findProfileById(host.model_profile_id);
  if (!found) {
    throw new Error(t(locale, 'profile.notFound'));
  }
  const profile = assertProfileConfigured(found);

  const historyText = meetingHistoryText(sessionId, session, members);

  const system = `You are the meeting host "${host.name}". Goal: ${session.meeting_goal}
Members:
${formatMemberBrief(members)}

After each round, assign the next speaker based on expertise and meeting progress.
At meeting start (round 0, no messages yet), assign an AI member (next_speaker_type=contact) to open the discussion.
If there is a contradiction, fork, or decision that only the human user can make, ask them to confirm instead of continuing the debate. Use ask_confirm with 2-4 short options. Do not ask_confirm every round.
Respond ONLY with JSON:
{"next_speaker_type":"user"|"contact","next_speaker_contact_id":"<uuid or member name>","reason":"...","should_end":false,"end_reason":null,"ask_confirm":null}
ask_confirm example: {"title":"...","prompt":"...","options":["A","B"],"allow_rating":true}
Set should_end true when the goal is met or the discussion should stop. Prefer exact member ids; member names are also accepted.`;

  const raw = await chatCompletion({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Round ${session.meeting_round_count}/${session.meeting_max_rounds}\nRecent:\n${historyText || '(no messages yet)'}`,
      },
    ],
  });

  const assignment = parseHostJson(raw);

  if (assignment.shouldEnd) {
    assignment.hostMessage = insertAiHostAssignmentMessage(
      sessionId,
      session.host_contact_id,
      assignment,
    );
    assignment.summaryMessage = await finalizeMeeting(sessionId, assignment.endReason ?? assignment.reason);
    return assignment;
  }

  if (assignment.askConfirm) {
    savePendingConfirm(sessionId, assignment.askConfirm);
    assignNextSpeaker(sessionId, { nextSpeakerType: 'user', contactId: null });
    const foundHost = findProfileById(host.model_profile_id);
    assignment.hostMessage = insertMeetingVisibleMessage({
      sessionId,
      role: 'assistant',
      content: `${assignment.reason ? `${assignment.reason.trim()}\n\n` : ''}${formatConfirmAskContent(assignment.askConfirm)}`,
      contactId: host.id,
      modelProfileId: foundHost?.id ?? null,
      modelLabel: foundHost ? profileLabel(foundHost) : null,
      kind: 'confirm_ask',
    });
    return assignment;
  }

  const mentionedInReason = findMentionedMembers(
    `${assignment.reason} ${assignment.nextSpeakerContactId ?? ''}`,
    members,
    session.host_contact_id,
  );
  const resolved =
    resolveMemberRef(assignment.nextSpeakerContactId, members) ?? mentionedInReason[0] ?? null;

  if (assignment.nextSpeakerType === 'contact' || resolved) {
    if (resolved) {
      assignment.nextSpeakerType = 'contact';
      assignment.nextSpeakerContactId = resolved.id;
    } else {
      assignment.nextSpeakerType = 'user';
      assignment.nextSpeakerContactId = null;
    }
  }

  assignNextSpeaker(sessionId, {
    nextSpeakerType: assignment.nextSpeakerType,
    contactId: assignment.nextSpeakerContactId,
  });

  assignment.hostMessage = insertAiHostAssignmentMessage(
    sessionId,
    session.host_contact_id,
    assignment,
  );

  return assignment;
}

export async function promptHostForNextSpeaker(
  sessionId: string,
  onEvent: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;

  if (session.meeting_status !== 'active') return;

  if (shouldAutoEndMeeting(session)) {
    const summary = await finalizeMeeting(sessionId, 'limit');
    if (summary) {
      onEvent({
        type: 'meeting_summary',
        messageId: summary.id,
        content: summary.content,
        contactId: summary.contact_id,
        createdAt: summary.created_at,
      });
    }
    onEvent({ type: 'meeting_ended', reason: 'max_rounds' });
    return;
  }

  if (session.host_type === 'ai') {
    const assignment = await runAiHostAssignment(sessionId);
    if (assignment.hostMessage) {
      onEvent({
        type: 'meeting_host_message',
        messageId: assignment.hostMessage.id,
        content: assignment.hostMessage.content,
        contactId: assignment.hostMessage.contact_id,
        createdAt: assignment.hostMessage.created_at,
      });
    }
    if (assignment.summaryMessage) {
      onEvent({
        type: 'meeting_summary',
        messageId: assignment.summaryMessage.id,
        content: assignment.summaryMessage.content,
        contactId: assignment.summaryMessage.contact_id,
        createdAt: assignment.summaryMessage.created_at,
      });
    }
    if (assignment.shouldEnd) {
      onEvent({ type: 'meeting_ended', reason: assignment.endReason ?? 'goal' });
    } else if (assignment.askConfirm) {
      onEvent({ type: 'meeting_confirm', confirm: assignment.askConfirm });
    } else {
      onEvent({
        type: 'meeting_assign',
        nextSpeakerType: assignment.nextSpeakerType,
        nextSpeakerContactId: assignment.nextSpeakerContactId,
        reason: assignment.reason,
      });
    }
  } else {
    clearNextSpeaker(sessionId);
    onEvent({ type: 'meeting_await_assign' });
  }
}

export async function afterMeetingAssistantReply(
  sessionId: string,
  onEvent: (payload: Record<string, unknown>) => void,
  lastAssistant?: { content: string; contactId: string | null },
): Promise<void> {
  incrementMeetingRound(sessionId);

  const members = listSessionMembers(sessionId);
  const mentioned = findMentionedMembers(
    lastAssistant?.content ?? '',
    members,
    lastAssistant?.contactId,
  );
  if (mentioned[0]) {
    assignNextSpeaker(sessionId, {
      nextSpeakerType: 'contact',
      contactId: mentioned[0].id,
    });
    onEvent({
      type: 'meeting_assign',
      nextSpeakerType: 'contact',
      nextSpeakerContactId: mentioned[0].id,
      reason: 'mention',
    });
    return;
  }

  await promptHostForNextSpeaker(sessionId, onEvent);
}

export function meetingHostLabel(session: SessionRow, members: ContactRow[]): string {
  const locale = getSettingsLocale();
  if (session.host_type === 'user') return t(locale, 'meeting.hostUser');
  if (session.host_type === 'ai' && session.host_contact_id) {
    const name = members.find((m) => m.id === session.host_contact_id)?.name;
    return name ? t(locale, 'meeting.hostAi', { name }) : t(locale, 'meeting.hostAiUnknown');
  }
  return '';
}
