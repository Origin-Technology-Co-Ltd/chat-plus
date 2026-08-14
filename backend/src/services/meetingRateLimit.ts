import { getDb } from '../db/init.js';

/** Fallback when session has no gap configured. */
export const MEETING_DEFAULT_GAP_SEC = 8;
/** Runaway guard only — real pace comes from meeting_speak_gap_sec. */
export const MEETING_MAX_SPEAKS_IN_WINDOW = 20;
export const MEETING_SPEAK_WINDOW_MS = 60_000;

export function getMeetingSpeakGapMs(sessionId: string): number {
  const row = getDb()
    .prepare('SELECT meeting_speak_gap_sec FROM sessions WHERE id = ?')
    .get(sessionId) as { meeting_speak_gap_sec?: number } | undefined;
  const sec =
    typeof row?.meeting_speak_gap_sec === 'number' ? row.meeting_speak_gap_sec : MEETING_DEFAULT_GAP_SEC;
  return Math.min(120, Math.max(2, sec)) * 1000;
}

export type MeetingRateCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'meeting_paused' | 'meeting_too_fast' | 'meeting_rate_limited';
      retryAfterMs?: number;
    };

/** In-memory speak timestamps per session (survives within process). */
const speakTimestamps = new Map<string, number[]>();

function prune(sessionId: string, now: number): number[] {
  const list = (speakTimestamps.get(sessionId) ?? []).filter(
    (ts) => now - ts < MEETING_SPEAK_WINDOW_MS,
  );
  speakTimestamps.set(sessionId, list);
  return list;
}

export function isMeetingAutoPaused(sessionId: string): boolean {
  const row = getDb()
    .prepare('SELECT meeting_auto_paused FROM sessions WHERE id = ?')
    .get(sessionId) as { meeting_auto_paused?: number } | undefined;
  return Boolean(row?.meeting_auto_paused);
}

export function pauseMeetingAuto(sessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET meeting_auto_paused = 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), sessionId);
}

export function resumeMeetingAuto(sessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET meeting_auto_paused = 0, updated_at = ? WHERE id = ?')
    .run(Date.now(), sessionId);
  speakTimestamps.set(sessionId, []);
}

export function checkMeetingSpeakRate(
  sessionId: string,
  options?: { afterHostAssign?: boolean },
): MeetingRateCheck {
  if (isMeetingAutoPaused(sessionId)) {
    return { ok: false, code: 'meeting_paused' };
  }

  const now = Date.now();
  const recent = prune(sessionId, now);
  const last = recent[recent.length - 1];
  const minGapMs = getMeetingSpeakGapMs(sessionId);

  // Host just named someone — allow that person to answer immediately.
  if (!options?.afterHostAssign && last !== undefined && now - last < minGapMs) {
    return {
      ok: false,
      code: 'meeting_too_fast',
      retryAfterMs: minGapMs - (now - last),
    };
  }

  if (recent.length >= MEETING_MAX_SPEAKS_IN_WINDOW) {
    pauseMeetingAuto(sessionId);
    return { ok: false, code: 'meeting_rate_limited' };
  }

  return { ok: true };
}

export function recordMeetingSpeak(sessionId: string): void {
  const now = Date.now();
  const recent = prune(sessionId, now);
  recent.push(now);
  speakTimestamps.set(sessionId, recent);

  if (recent.length >= MEETING_MAX_SPEAKS_IN_WINDOW) {
    pauseMeetingAuto(sessionId);
  }
}

export function clearMeetingSpeakRate(sessionId: string): void {
  speakTimestamps.delete(sessionId);
}
