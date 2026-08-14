import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Contact, ContextSnapshot, Message, SessionDetail } from '../api/client';
import {
  ApiError,
  askMeetingConfirm,
  assignMeetingSpeaker,
  exportSession,
  fetchContacts,
  fetchSession,
  fetchSessionContext,
  parseMeetingPendingConfirm,
  patchSession,
  pauseMeeting,
  resumeMeeting,
  streamChat,
  streamMeetingSpeak,
  submitMeetingConfirm,
} from '../api/client';
import { useI18n } from '../i18n/LocaleContext';
import { AddMembersModal } from './AddMembersModal';
import { AskConfirmModal } from './AskConfirmModal';
import { ExportDialog } from './ExportDialog';
import { MeetingConfirmCard } from './MeetingConfirmCard';
import { MessageMarkdown } from './MessageMarkdown';
import { StartMeetingModal } from './StartMeetingModal';

type RoomChatViewProps = {
  sessionId: string | null;
  contacts: Contact[];
  settingsEpoch?: number;
  exportAskEachTime: boolean;
  exportDir: string;
  onSessionUpdated: () => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

function formatTokens(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return String(value);
}

function contactNameById(members: Contact[], id: string | null | undefined): string | null {
  if (!id) return null;
  return members.find((m) => m.id === id)?.name ?? null;
}

function speakerLabel(message: Message, members: Contact[], you: string, assistant: string): string {
  if (message.role === 'user') return you;
  const name = contactNameById(members, message.contact_id);
  return name ?? assistant;
}

function replyTargetName(message: Message, members: Contact[]): string {
  if (message.role === 'assistant') {
    return contactNameById(members, message.contact_id) ?? message.model_label ?? '?';
  }
  return contactNameById(members, message.target_contact_id) ?? '?';
}

const NEAR_BOTTOM_PX = 96;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

export function RoomChatView({
  sessionId,
  contacts,
  settingsEpoch = 0,
  exportAskEachTime,
  exportDir,
  onSessionUpdated,
  onError,
  onInfo,
}: RoomChatViewProps) {
  const { t } = useI18n();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [startMeetingOpen, setStartMeetingOpen] = useState(false);
  const [askConfirmOpen, setAskConfirmOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [endingMeeting, setEndingMeeting] = useState(false);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [mentionContactId, setMentionContactId] = useState<string | null>(null);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0);
  /** User cleared @ / default — do not fall back to latest AI until they pick again. */
  const [suppressDefaultTarget, setSuppressDefaultTarget] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const spokenTurnKeyRef = useRef<string | null>(null);
  const meetingSpeakInFlightRef = useRef(false);
  const speakTimestampsRef = useRef<number[]>([]);
  const [localPaused, setLocalPaused] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const members = session?.members ?? [];
  const isMeetingActive = session?.room_mode === 'meeting' && session?.meeting_status === 'active';
  const isMeetingEnded = session?.room_mode === 'meeting' && session?.meeting_status === 'ended';
  const isMeetingPaused = Boolean(session?.meeting_auto_paused) || localPaused;
  const pendingConfirm = useMemo(
    () => parseMeetingPendingConfirm(session?.meeting_pending_confirm),
    [session?.meeting_pending_confirm],
  );

  const messages: Message[] = useMemo(() => {
    if (!session) return [];
    if (session.messages?.length) return session.messages;
    return session.threadTree?.messages ?? [];
  }, [session]);

  const replyMessage = useMemo(
    () => (replyToMessageId ? messages.find((m) => m.id === replyToMessageId) ?? null : null),
    [messages, replyToMessageId],
  );

  const mentionContact = useMemo(
    () => (mentionContactId ? members.find((m) => m.id === mentionContactId) ?? null : null),
    [members, mentionContactId],
  );

  const filteredMembers = useMemo(() => {
    const q = mentionFilter.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, mentionFilter]);

  /** Latest AI still in the room — used when no @ / quote. */
  const latestAiContactId = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.id));
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.id.startsWith('temp-')) continue;
      if (m.role === 'assistant' && m.contact_id && memberIds.has(m.contact_id)) {
        return m.contact_id;
      }
      if (m.role === 'user' && m.target_contact_id && memberIds.has(m.target_contact_id)) {
        return m.target_contact_id;
      }
    }
    return null;
  }, [messages, members]);

  useEffect(() => {
    setMentionHighlightIndex(0);
  }, [mentionFilter, mentionPickerOpen, filteredMembers.length]);

  const included = useMemo(
    () => new Set(context?.includedMessageIds ?? []),
    [context?.includedMessageIds],
  );

  const showTrimHint = Boolean(context?.trimmed && context.autoTrim);
  const overWindow = Boolean(context && !context.autoTrim && context.sentTokens > context.window);

  const refreshContext = useCallback(async (id: string) => {
    try {
      const snapshot = await fetchSessionContext(id);
      setContext(snapshot);
    } catch {
      // non-fatal
    }
  }, []);

  const reloadSession = useCallback(
    async (id: string) => {
      const detail = await fetchSession(id);
      setSession(detail);
      await refreshContext(id);
      return detail;
    },
    [refreshContext],
  );

  /** Frontend tripwire: pace comes from meeting_speak_gap_sec. */
  function checkLocalSpeakRate(): 'ok' | 'too_fast' | 'rate_limited' {
    const now = Date.now();
    const recent = speakTimestampsRef.current.filter((ts) => now - ts < 60_000);
    speakTimestampsRef.current = recent;
    const last = recent[recent.length - 1];
    const gapMs = Math.max(2000, (session?.meeting_speak_gap_sec ?? 8) * 1000);
    if (last !== undefined && now - last < gapMs) return 'too_fast';
    if (recent.length >= 20) return 'rate_limited';
    return 'ok';
  }

  function markLocalSpeak(): void {
    const now = Date.now();
    const recent = speakTimestampsRef.current.filter((ts) => now - ts < 60_000);
    recent.push(now);
    speakTimestampsRef.current = recent;
    if (recent.length >= 20) setLocalPaused(true);
  }

  const runMeetingSpeak = useCallback(
    async (detail: SessionDetail, options?: { afterHostAssign?: boolean }) => {
      if (!sessionId) return;
      if (detail.room_mode !== 'meeting' || detail.meeting_status !== 'active') return;
      if (parseMeetingPendingConfirm(detail.meeting_pending_confirm)) return;
      if (detail.next_speaker_type !== 'contact' || !detail.next_speaker_contact_id) return;
      if (detail.meeting_auto_paused || localPaused) {
        onInfo(t('meeting.pausedBanner'));
        return;
      }

      const afterHostAssign = Boolean(options?.afterHostAssign);
      const rate = afterHostAssign ? 'ok' : checkLocalSpeakRate();
      if (rate !== 'ok') {
        setLocalPaused(true);
        onError(rate === 'too_fast' ? t('meeting.tooFastAlert') : t('meeting.rateLimitedAlert'));
        return;
      }

      const turnKey = `${detail.next_speaker_contact_id}:${detail.meeting_round_count}`;
      if (spokenTurnKeyRef.current === turnKey || meetingSpeakInFlightRef.current) return;
      spokenTurnKeyRef.current = turnKey;
      meetingSpeakInFlightRef.current = true;
      markLocalSpeak();

      const contactId = detail.next_speaker_contact_id;
      setStreaming(true);

      const optimisticAssistant: Message = {
        id: `temp-assistant-${Date.now()}`,
        session_id: sessionId,
        thread_id: detail.rootThreadId,
        role: 'assistant',
        content: '',
        created_at: Date.now(),
        contact_id: contactId,
      };

      setSession((prev) => {
        if (!prev) return prev;
        const nextMessages = [...(prev.messages ?? []), optimisticAssistant];
        return {
          ...prev,
          messages: nextMessages,
          threadTree: { ...prev.threadTree, messages: nextMessages },
        };
      });

      try {
        const result = await streamMeetingSpeak(
          sessionId,
          (delta) => {
            setSession((prev) => {
              if (!prev) return prev;
              const msgs = [...(prev.messages ?? [])];
              const last = msgs[msgs.length - 1];
              if (last?.role === 'assistant' && last.id.startsWith('temp-')) {
                msgs[msgs.length - 1] = { ...last, content: last.content + delta };
              }
              return {
                ...prev,
                messages: msgs,
                threadTree: { ...prev.threadTree, messages: msgs },
              };
            });
          },
          { afterHostAssign },
        );

        if (result.context) setContext(result.context);
        if (result.meeting?.hostMessage) {
          const hostMsg = result.meeting.hostMessage;
          setSession((prev) => {
            if (!prev) return prev;
            if ((prev.messages ?? []).some((m) => m.id === hostMsg.id)) return prev;
            const extra: Message = {
              id: hostMsg.id,
              session_id: sessionId,
              thread_id: prev.rootThreadId,
              role: 'assistant',
              content: hostMsg.content,
              created_at: hostMsg.createdAt ?? Date.now(),
              contact_id: hostMsg.contactId ?? null,
            };
            const nextMessages = [...(prev.messages ?? []), extra];
            return {
              ...prev,
              messages: nextMessages,
              threadTree: { ...prev.threadTree, messages: nextMessages },
            };
          });
        }

        const refreshed = await reloadSession(sessionId);
        onSessionUpdated();

        if (result.meeting?.ended) {
          onInfo(t('meeting.endedHint'));
          return;
        }

        // Host just named the next speaker — that person answers once.
        if (
          !localPaused &&
          !refreshed.meeting_auto_paused &&
          refreshed.meeting_status === 'active' &&
          refreshed.next_speaker_type === 'contact' &&
          refreshed.next_speaker_contact_id
        ) {
          meetingSpeakInFlightRef.current = false;
          spokenTurnKeyRef.current = null;
          setStreaming(false);
          await runMeetingSpeak(refreshed, { afterHostAssign: true });
        }
      } catch (err) {
        spokenTurnKeyRef.current = null;
        if (err instanceof ApiError && (
          err.code === 'meeting_too_fast' ||
          err.code === 'meeting_rate_limited' ||
          err.code === 'meeting_paused' ||
          err.status === 429
        )) {
          setLocalPaused(true);
          onError(
            err.code === 'meeting_rate_limited'
              ? t('meeting.rateLimitedAlert')
              : err.code === 'meeting_paused'
                ? t('meeting.pausedBanner')
                : t('meeting.tooFastAlert'),
          );
        } else {
          onError(err instanceof Error ? err.message : t('chat.sendFailed'));
        }
        if (sessionId) {
          try {
            await reloadSession(sessionId);
          } catch {
            // ignore
          }
        }
      } finally {
        meetingSpeakInFlightRef.current = false;
        setStreaming(false);
      }
    },
    [localPaused, onError, onInfo, onSessionUpdated, reloadSession, sessionId, t],
  );

  const tryAutoMeetingSpeak = useCallback(
    async (detail: SessionDetail, options?: { afterHostAssign?: boolean }) => {
      if (detail.room_mode !== 'meeting' || detail.meeting_status !== 'active') return;
      if (parseMeetingPendingConfirm(detail.meeting_pending_confirm)) return;
      if (detail.next_speaker_type !== 'contact' || !detail.next_speaker_contact_id) return;
      if (detail.meeting_auto_paused) {
        setLocalPaused(true);
        return;
      }
      await runMeetingSpeak(detail, { afterHostAssign: options?.afterHostAssign ?? true });
    },
    [runMeetingSpeak],
  );

  async function handleResumeMeeting(): Promise<void> {
    if (!sessionId) return;
    try {
      await resumeMeeting(sessionId);
      speakTimestampsRef.current = [];
      setLocalPaused(false);
      spokenTurnKeyRef.current = null;
      const detail = await reloadSession(sessionId);
      onSessionUpdated();
      await tryAutoMeetingSpeak(detail, { afterHostAssign: true });
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.sendFailed'));
    }
  }

  async function handlePauseMeeting(): Promise<void> {
    if (!sessionId) return;
    try {
      await pauseMeeting(sessionId);
      setLocalPaused(true);
      await reloadSession(sessionId);
      onSessionUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.sendFailed'));
    }
  }

  async function handleSpeakGapChange(sec: number): Promise<void> {
    if (!sessionId) return;
    try {
      await patchSession(sessionId, { meetingSpeakGapSec: sec });
      await reloadSession(sessionId);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.sendFailed'));
    }
  }

  async function saveRoomTitle(): Promise<void> {
    if (!sessionId) return;
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === session?.title) return;
    try {
      await patchSession(sessionId, { title: next });
      await reloadSession(sessionId);
      onSessionUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.sendFailed'));
    }
  }

  async function handleEndMeeting(): Promise<void> {
    if (!sessionId || endingMeeting) return;
    setEndingMeeting(true);
    try {
      await patchSession(sessionId, { endMeeting: true });
      await reloadSession(sessionId);
      onSessionUpdated();
      onInfo(t('meeting.endedHint'));
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.sendFailed'));
    } finally {
      setEndingMeeting(false);
    }
  }

  async function handleSubmitConfirm(input: {
    selectedIds: string[];
    ratings?: Record<string, number>;
    comment?: string;
  }): Promise<void> {
    if (!sessionId || confirmSubmitting) return;
    setConfirmSubmitting(true);
    try {
      const detail = await submitMeetingConfirm(sessionId, input);
      setSession(detail);
      onSessionUpdated();
      await tryAutoMeetingSpeak(detail, { afterHostAssign: true });
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.sendFailed'));
    } finally {
      setConfirmSubmitting(false);
    }
  }

  async function handleContinueSpeak(): Promise<void> {
    if (!session || !sessionId || streaming || isMeetingPaused) return;
    await runMeetingSpeak(session);
  }

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setContext(null);
      setInput('');
      setMentionContactId(null);
      setReplyToMessageId(null);
      setMentionPickerOpen(false);
      setSuppressDefaultTarget(false);
      spokenTurnKeyRef.current = null;
      speakTimestampsRef.current = [];
      setLocalPaused(false);
      setStickToBottom(true);
      return;
    }

    setLoading(true);
    setInput('');
    setMentionContactId(null);
    setReplyToMessageId(null);
    setMentionPickerOpen(false);
    setSuppressDefaultTarget(false);
    spokenTurnKeyRef.current = null;
    speakTimestampsRef.current = [];
    setLocalPaused(false);
    setStickToBottom(true);
    reloadSession(sessionId)
      .catch((err) => onError(err instanceof Error ? err.message : t('chat.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload on session change
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || settingsEpoch === 0) return;
    void refreshContext(sessionId);
  }, [settingsEpoch, sessionId, refreshContext]);

  useEffect(() => {
    if (!stickToBottom) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming, stickToBottom]);

  function handleMessageListScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    setStickToBottom(isNearBottom(el));
  }

  function jumpToBottom(): void {
    setStickToBottom(true);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  useEffect(() => {
    if (session?.meeting_status !== 'active' || !session.meeting_max_minutes) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [session?.meeting_status, session?.meeting_max_minutes]);

  function clearTargets(): void {
    setMentionContactId(null);
    setReplyToMessageId(null);
    setSuppressDefaultTarget(false);
  }

  function mentionTokenRange(value: string, name: string): { start: number; end: number } | null {
    const token = `@${name}`;
    const start = value.indexOf(token);
    if (start < 0) return null;
    let end = start + token.length;
    if (value[end] === ' ') end += 1;
    return { start, end };
  }

  /** Backspace/Delete once removes the whole `@Name` token. */
  function tryDeleteMentionToken(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (!mentionContact) return false;
    const el = textareaRef.current;
    if (!el) return false;

    const range = mentionTokenRange(input, mentionContact.name);
    if (!range) return false;

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    let hit = false;
    if (start !== end) {
      hit = start < range.end && end > range.start;
    } else if (event.key === 'Backspace') {
      hit = start > range.start && start <= range.end;
    } else {
      hit = start >= range.start && start < range.end;
    }
    if (!hit) return false;

    event.preventDefault();
    const next = `${input.slice(0, range.start)}${input.slice(range.end)}`;
    handleInputChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(range.start, range.start);
    });
    return true;
  }

  function selectMention(contact: Contact, replaceAtToken?: boolean): void {
    setMentionContactId(contact.id);
    setSuppressDefaultTarget(false);
    setMentionPickerOpen(false);
    setMentionFilter('');
    if (replaceAtToken) {
      setInput((prev) => {
        const at = prev.lastIndexOf('@');
        if (at < 0) return prev;
        const before = prev.slice(0, at);
        const afterMatch = prev.slice(at + 1).match(/^(\S*)(.*)$/);
        const rest = afterMatch ? afterMatch[2] : '';
        return `${before}@${contact.name}${rest.startsWith(' ') || rest === '' ? rest : ` ${rest}`}`;
      });
    }
    textareaRef.current?.focus();
  }

  function handleInputChange(value: string): void {
    setInput(value);

    if (mentionContactId) {
      const named = members.find((m) => m.id === mentionContactId);
      if (named && !value.includes(`@${named.name}`)) {
        setMentionContactId(null);
        setSuppressDefaultTarget(true);
      }
    }

    const at = value.lastIndexOf('@');
    if (at >= 0) {
      const after = value.slice(at + 1);
      if (!after.includes(' ') && !after.includes('\n')) {
        setMentionPickerOpen(true);
        setMentionFilter(after);
        return;
      }
    }
    setMentionPickerOpen(false);
    setMentionFilter('');
  }

  function setQuote(message: Message): void {
    if (message.id.startsWith('temp-')) return;
    setReplyToMessageId(message.id);
    setSuppressDefaultTarget(false);
    textareaRef.current?.focus();
  }

  async function handleSend(): Promise<void> {
    if (!sessionId || streaming) return;
    const content = input.trim();
    if (!content) return;

    const mentionId = mentionContactId ?? undefined;
    const replyId = replyToMessageId ?? undefined;
    const fallbackLatest = suppressDefaultTarget ? null : latestAiContactId;
    const resolvedTargetId =
      mentionId ??
      (replyId
        ? (() => {
            let cursor: string | null | undefined = replyId;
            const seen = new Set<string>();
            while (cursor) {
              if (seen.has(cursor)) break;
              seen.add(cursor);
              const msg = messages.find((m) => m.id === cursor);
              if (!msg) break;
              if (msg.role === 'assistant' && msg.contact_id) return msg.contact_id;
              if (msg.role === 'user' && msg.target_contact_id) return msg.target_contact_id;
              cursor = msg.reply_to_message_id;
            }
            return fallbackLatest;
          })()
        : fallbackLatest) ??
      undefined;

    setInput('');
    setMentionPickerOpen(false);
    setStickToBottom(true);
    setStreaming(true);

    const optimisticUser: Message = {
      id: `temp-user-${Date.now()}`,
      session_id: sessionId,
      thread_id: session?.rootThreadId ?? '',
      role: 'user',
      content,
      created_at: Date.now(),
      target_contact_id: resolvedTargetId ?? null,
      reply_to_message_id: replyId ?? null,
    };
    const optimisticAssistant: Message = {
      id: `temp-assistant-${Date.now()}`,
      session_id: sessionId,
      thread_id: session?.rootThreadId ?? '',
      role: 'assistant',
      content: '',
      created_at: Date.now(),
      contact_id: resolvedTargetId ?? null,
    };

    const willStream = Boolean(resolvedTargetId);
    const allowDefaultTarget = !suppressDefaultTarget;
    setSession((prev) => {
      if (!prev) return prev;
      const nextMessages = willStream
        ? [...(prev.messages ?? []), optimisticUser, optimisticAssistant]
        : [...(prev.messages ?? []), optimisticUser];
      return {
        ...prev,
        messages: nextMessages,
        threadTree: {
          ...prev.threadTree,
          messages: nextMessages,
        },
      };
    });

    clearTargets();

    try {
      const result = await streamChat(sessionId, content, (delta) => {
        setSession((prev) => {
          if (!prev) return prev;
          const msgs = [...(prev.messages ?? [])];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant' && last.id.startsWith('temp-')) {
            msgs[msgs.length - 1] = { ...last, content: last.content + delta };
          }
          return {
            ...prev,
            messages: msgs,
            threadTree: { ...prev.threadTree, messages: msgs },
          };
        });
      }, {
        mentionContactId: mentionId,
        replyToMessageId: replyId,
        allowDefaultTarget,
      });

      if (result.noop) {
        onInfo(t('room.noTargetSaved'));
      }
      if (result.context) setContext(result.context);
      if (result.meeting?.hostMessage) {
        const hostMsg = result.meeting.hostMessage;
        setSession((prev) => {
          if (!prev) return prev;
          if ((prev.messages ?? []).some((m) => m.id === hostMsg.id)) return prev;
          const extra: Message = {
            id: hostMsg.id,
            session_id: sessionId,
            thread_id: prev.rootThreadId,
            role: 'assistant',
            content: hostMsg.content,
            created_at: hostMsg.createdAt ?? Date.now(),
            contact_id: hostMsg.contactId ?? null,
          };
          const nextMessages = [...(prev.messages ?? []), extra];
          return {
            ...prev,
            messages: nextMessages,
            threadTree: { ...prev.threadTree, messages: nextMessages },
          };
        });
      }
      const refreshed = await reloadSession(sessionId);
      onSessionUpdated();
      if (
        refreshed.room_mode === 'meeting' &&
        refreshed.meeting_status === 'active' &&
        refreshed.next_speaker_type === 'contact' &&
        refreshed.next_speaker_contact_id &&
        !refreshed.meeting_auto_paused
      ) {
        await tryAutoMeetingSpeak(refreshed, { afterHostAssign: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONTEXT_OVERFLOW') {
        onError(err.message);
      } else {
        onError(err instanceof Error ? err.message : t('chat.sendFailed'));
      }
      if (sessionId) {
        try {
          await reloadSession(sessionId);
        } catch {
          // ignore
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  async function performExport(customPath?: string): Promise<void> {
    if (!sessionId) return;
    try {
      const result = await exportSession(sessionId, customPath);
      onInfo(t('chat.exported', { path: result.path }));
      setExportOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.exportFailed'));
    }
  }

  if (!sessionId) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white text-sm text-stone-400">
        {t('chat.empty')}
      </main>
    );
  }

  if (loading && !session) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white text-sm text-stone-500">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{t('chat.loading')}</span>
        </div>
      </main>
    );
  }

  const suggestedExportPath = `${exportDir.replace(/\/$/, '')}/${session?.title ?? 'room'}`;

  return (
    <main className="relative flex flex-1 flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6 py-3 z-10">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {editingTitle ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void saveRoomTitle()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveRoomTitle();
                  }
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-teal-300 px-2 py-0.5 text-[15px] font-semibold text-stone-900 outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(session?.title ?? '');
                  setEditingTitle(true);
                }}
                title={t('room.rename')}
                className="min-w-0 truncate text-left text-[15px] font-semibold tracking-tight text-stone-900 hover:text-teal-800"
              >
                {session?.title ?? t('chat.conversation')}
              </button>
            )}
            <span className="shrink-0 rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-200/80">
              {t('sidebar.roomBadge')}
            </span>
          </div>
          {context ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono text-stone-500">
              <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
                {t('chat.sentTokens', {
                  sent: formatTokens(context.sentTokens),
                  window: formatTokens(context.window),
                  ratio: (context.ratio * 100).toFixed(1),
                })}
              </span>
              {showTrimHint ? <span className="font-sans text-amber-600">{t('chat.trimHint')}</span> : null}
              {overWindow ? <span className="font-sans text-rose-600">{t('chat.overWindow')}</span> : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (exportAskEachTime) setExportOpen(true);
            else void performExport();
          }}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors duration-150"
        >
          <svg className="h-3.5 w-3.5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {t('chat.exportDir')}
        </button>
      </header>

      {/* Member strip */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-stone-200 bg-stone-50/80 px-4 py-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-stone-400">
          {t('room.members')}
        </span>
        {members.map((member) => {
          const active = mentionContactId === member.id;
          return (
            <button
              key={member.id}
              type="button"
              onClick={() => {
                if (mentionContactId === member.id) {
                  setMentionContactId(null);
                  setSuppressDefaultTarget(true);
                } else {
                  setMentionContactId(member.id);
                  setSuppressDefaultTarget(false);
                }
              }}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-teal-600 text-white'
                  : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-teal-50 hover:text-teal-800 hover:ring-teal-200'
              }`}
            >
              @{member.name}
            </button>
          );
        })}
        <button type="button" onClick={async () => { setLocalContacts(await fetchContacts().catch(() => contacts)); setAddMembersOpen(true); }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-stone-500 ring-1 ring-stone-200 hover:bg-stone-100">{t('room.addMembers')}</button>
        {members.length >= 2 && !isMeetingActive && !isMeetingEnded ? (
          <button type="button" onClick={() => setStartMeetingOpen(true)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">{t('meeting.start')}</button>
        ) : null}
        {isMeetingActive ? (
          <>
            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{t('meeting.activeBadge')}</span>
            {session && session.meeting_max_rounds > 0 ? (
              <span className="text-[10px] text-stone-500">{t('meeting.round', { current: String(session.meeting_round_count ?? 0), max: String(session.meeting_max_rounds) })}</span>
            ) : null}
            {session && session.meeting_max_minutes > 0 && session.meeting_started_at ? (
              <span className="text-[10px] text-stone-500">
                {t('meeting.timeLeft', {
                  minutes: String(
                    Math.max(
                      0,
                      Math.ceil(
                        (session.meeting_started_at + session.meeting_max_minutes * 60_000 - nowTs) /
                          60_000,
                      ),
                    ),
                  ),
                })}
              </span>
            ) : null}
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-stone-500">
              {t('meeting.speakGap')}
              <select
                value={session?.meeting_speak_gap_sec ?? 8}
                onChange={(e) => void handleSpeakGapChange(Number(e.target.value))}
                className="rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px] text-stone-700"
              >
                {[3, 5, 8, 15, 30].map((sec) => (
                  <option key={sec} value={sec}>
                    {t('meeting.speakGapOption', { sec: String(sec) })}
                  </option>
                ))}
              </select>
            </label>
            {isMeetingPaused ? (
              <button type="button" onClick={() => void handleResumeMeeting()} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50">{t('meeting.resume')}</button>
            ) : (
              <button type="button" onClick={() => void handlePauseMeeting()} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-50">{t('meeting.pause')}</button>
            )}
            <button type="button" onClick={() => setAskConfirmOpen(true)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50">{t('meeting.askConfirm')}</button>
            <button type="button" disabled={endingMeeting} onClick={() => void handleEndMeeting()} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-40">{endingMeeting ? t('meeting.ending') : t('meeting.end')}</button>
          </>
        ) : null}
        {isMeetingEnded ? (
          <>
            <span className="shrink-0 rounded-md bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">{t('meeting.endedBadge')}</span>
            <button type="button" onClick={async () => { await patchSession(sessionId!, { returnToSpecified: true }); await reloadSession(sessionId!); onSessionUpdated(); }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50">{t('meeting.backToSpecified')}</button>
          </>
        ) : null}
      </div>

      {/* Meeting rate-limit pause banner */}
      {isMeetingActive && isMeetingPaused ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
          <span className="font-medium">{t('meeting.pausedBanner')}</span>
          <button
            type="button"
            onClick={() => void handleResumeMeeting()}
            className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-medium text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100"
          >
            {t('meeting.resume')}
          </button>
        </div>
      ) : null}

      {/* Meeting assign bar for user host */}
      {isMeetingActive && !isMeetingPaused && session?.host_type === 'user' && session?.next_speaker_type === null ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-medium">{t('meeting.assignPrompt')}</span>
          {members.map((m) => (
            <button key={m.id} type="button" onClick={async () => { await assignMeetingSpeaker(sessionId!, { nextSpeakerType: 'contact', contactId: m.id }); const detail = await reloadSession(sessionId!); await tryAutoMeetingSpeak(detail); }} className="rounded px-2 py-0.5 bg-white ring-1 ring-amber-200 hover:bg-amber-100">{m.name}</button>
          ))}
          <button type="button" onClick={async () => { await assignMeetingSpeaker(sessionId!, { nextSpeakerType: 'user' }); await reloadSession(sessionId!); }} className="rounded px-2 py-0.5 bg-white ring-1 ring-amber-200 hover:bg-amber-100">{t('meeting.assignUser')}</button>
        </div>
      ) : null}

      {/* Meeting next speaker hint + manual continue (no auto-chain) */}
      {isMeetingActive && session?.next_speaker_type === 'contact' && session?.next_speaker_contact_id ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-teal-200 bg-teal-50 px-4 py-1.5 text-xs text-teal-800">
          <span>
            {t('meeting.nextSpeaker', {
              name: contactNameById(members, session.next_speaker_contact_id) ?? '?',
            })}
          </span>
          {!isMeetingPaused && !streaming ? (
            <button
              type="button"
              onClick={() => void handleContinueSpeak()}
              className="rounded-lg bg-teal-600 px-2.5 py-0.5 font-medium text-white hover:bg-teal-700"
            >
              {t('meeting.continueSpeak')}
            </button>
          ) : null}
        </div>
      ) : null}

      {isMeetingActive && pendingConfirm ? (
        <MeetingConfirmCard
          confirm={pendingConfirm}
          submitting={confirmSubmitting}
          onSubmit={(input) => void handleSubmitConfirm(input)}
        />
      ) : null}

      {/* Meeting ended hint */}
      {isMeetingEnded ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs text-stone-600">
          {t('meeting.endedHint')}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleMessageListScroll}
          className="h-full overflow-y-auto px-4 py-4"
        >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {showTrimHint ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('chat.trimExplain')}
            </div>
          ) : null}
          {overWindow ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {t('chat.overWindowExplain')}
            </div>
          ) : null}

          {messages.map((message) => {
            const isUser = message.role === 'user';
            const inWindow =
              !context?.autoTrim ||
              !context.trimmed ||
              included.size === 0 ||
              included.has(message.id) ||
              message.id.startsWith('temp-');
            const isStreamingHere =
              streaming &&
              message.role === 'assistant' &&
              message.id.startsWith('temp-') &&
              !message.content;

            return (
              <div
                key={message.id}
                className={`group relative flex flex-col ${
                  isUser ? 'items-end' : 'items-start'
                } ${inWindow ? 'opacity-100' : 'opacity-40 filter grayscale-[20%]'}`}
              >
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-stone-400">
                  <span>{speakerLabel(message, members, t('room.you'), t('chat.assistant'))}</span>
                  {message.kind === 'summary' ? (
                    <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800">
                      {t('meeting.summaryBadge')}
                    </span>
                  ) : null}
                  {message.kind === 'confirm_ask' ? (
                    <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                      {t('meeting.confirmAskBadge')}
                    </span>
                  ) : null}
                  {message.kind === 'confirm_answer' ? (
                    <span className="rounded bg-teal-100 px-1 text-[10px] font-semibold text-teal-800">
                      {t('meeting.confirmAnswerBadge')}
                    </span>
                  ) : null}
                  {isMeetingActive &&
                  session?.host_type === 'ai' &&
                  message.role === 'assistant' &&
                  message.contact_id &&
                  message.contact_id === session.host_contact_id &&
                  message.kind !== 'summary' ? (
                    <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                      {t('meeting.hostBadge')}
                    </span>
                  ) : null}
                  {!inWindow ? (
                    <span className="rounded bg-stone-200/80 px-1 text-[10px] font-normal text-stone-500">
                      {t('chat.notInUpstream')}
                    </span>
                  ) : null}
                </div>

                {message.reply_to_message_id ? (
                  <div
                    className={`mb-1 max-w-[90%] truncate rounded-md px-2 py-0.5 text-[10px] ${
                      isUser ? 'bg-teal-700/30 text-teal-50' : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {t('room.replyTo', {
                      name: replyTargetName(
                        messages.find((m) => m.id === message.reply_to_message_id) ?? message,
                        members,
                      ),
                    })}
                  </div>
                ) : null}

                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed animate-fade-in ${
                    isUser
                      ? 'whitespace-pre-wrap bg-teal-600 text-white rounded-tr-md'
                      : 'bg-white border border-stone-200 text-stone-800 rounded-tl-md'
                  }`}
                >
                  {isStreamingHere ? (
                    <span className="inline-flex items-center gap-1 font-medium text-stone-400 animate-pulse-subtle">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  ) : isUser ? (
                    message.content
                  ) : (
                    <MessageMarkdown content={message.content} />
                  )}
                </div>

                {!message.id.startsWith('temp-') ? (
                  <button
                    type="button"
                    onClick={() => setQuote(message)}
                    className="mt-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-stone-400 opacity-0 transition-opacity hover:bg-stone-100 hover:text-teal-700 group-hover:opacity-100"
                  >
                    {t('room.quote')}
                  </button>
                ) : null}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        </div>
        {!stickToBottom ? (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-stone-800/90 px-3.5 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-sm hover:bg-stone-700"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            {t('chat.jumpToBottom')}
          </button>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        className="shrink-0 border-t border-stone-200 bg-white p-3"
      >
        <div className="mx-auto max-w-3xl">
          {replyMessage ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-700 ring-1 ring-stone-200">
                <span className="truncate">
                  {t('room.replyTo', { name: replyTargetName(replyMessage, members) })}
                  {replyMessage.content.trim()
                    ? ` · ${replyMessage.content.trim().slice(0, 48)}${
                        replyMessage.content.trim().length > 48 ? '…' : ''
                      }`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyToMessageId(null)}
                  className="ml-0.5 shrink-0 rounded text-stone-500 hover:text-stone-800"
                  aria-label="clear reply"
                >
                  ×
                </button>
              </span>
            </div>
          ) : null}

          <div className="relative flex gap-2 items-end">
            <div className="relative flex-1 rounded-xl border border-stone-200 bg-stone-50 p-2 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/15 transition-all duration-200">
              {mentionPickerOpen && filteredMembers.length > 0 ? (
                <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-40 w-56 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-pop">
                  {filteredMembers.map((member, index) => (
                    <li key={member.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setMentionHighlightIndex(index)}
                        onClick={() => selectMention(member, true)}
                        className={`flex w-full px-3 py-1.5 text-left text-xs font-medium ${
                          index === mentionHighlightIndex
                            ? 'bg-teal-50 text-teal-800'
                            : 'text-stone-700 hover:bg-teal-50 hover:text-teal-800'
                        }`}
                      >
                        @{member.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                rows={2}
                onKeyDown={(event) => {
                  if (tryDeleteMentionToken(event)) return;
                  if (mentionPickerOpen && filteredMembers.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setMentionHighlightIndex((i) =>
                        i >= filteredMembers.length - 1 ? 0 : i + 1,
                      );
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setMentionHighlightIndex((i) =>
                        i <= 0 ? filteredMembers.length - 1 : i - 1,
                      );
                      return;
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      const picked = filteredMembers[mentionHighlightIndex];
                      if (picked) selectMention(picked, true);
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setMentionPickerOpen(false);
                      return;
                    }
                  }
                  if (event.key === 'Escape' && mentionPickerOpen) {
                    event.preventDefault();
                    setMentionPickerOpen(false);
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                className="w-full resize-none bg-transparent px-1 text-sm text-stone-800 outline-none placeholder:text-stone-400"
              />
            </div>
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 active:bg-teal-800"
            >
              {streaming ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                t('chat.send')
              )}
            </button>
          </div>
        </div>
      </form>

      <AddMembersModal
        sessionId={sessionId!}
        currentMemberIds={members.map((m) => m.id)}
        contacts={localContacts}
        open={addMembersOpen}
        onClose={() => setAddMembersOpen(false)}
        onUpdated={() => { void reloadSession(sessionId!); onSessionUpdated(); }}
        onError={onError}
      />

      <StartMeetingModal
        members={members}
        open={startMeetingOpen}
        onClose={() => setStartMeetingOpen(false)}
        onStart={async (input) => {
          try {
            await patchSession(sessionId!, {
              startMeeting: {
                goal: input.goal,
                hostType: input.hostType,
                hostContactId: input.hostContactId,
                maxRounds: input.maxRounds,
                maxMinutes: input.maxMinutes,
                speakGapSec: input.speakGapSec,
                continueHistory: input.continueHistory,
              },
            });
            const detail = await reloadSession(sessionId!);
            onSessionUpdated();
            await tryAutoMeetingSpeak(detail);
          } catch (err) {
            onError(err instanceof Error ? err.message : t('app.createSessionFailed'));
          }
        }}
      />

      <AskConfirmModal
        open={askConfirmOpen}
        onClose={() => setAskConfirmOpen(false)}
        onSubmit={(input) => {
          if (!sessionId) return;
          void (async () => {
            try {
              await askMeetingConfirm(sessionId, input);
              await reloadSession(sessionId);
              onSessionUpdated();
            } catch (err) {
              onError(err instanceof Error ? err.message : t('chat.sendFailed'));
            }
          })();
        }}
      />

      <ExportDialog
        open={exportOpen}
        defaultPath={suggestedExportPath}
        onClose={() => setExportOpen(false)}
        onConfirm={(path) => void performExport(path)}
      />
    </main>
  );
}
