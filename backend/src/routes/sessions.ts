import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '../i18n/index.js';
import {
  prepareChatMessages,
  prepareMeetingSpeakMessages,
  prepareRoomChatMessages,
  buildRoomContextSnapshot,
  buildThreadContextSnapshot,
} from '../services/assemble.js';
import { resolveExportPath, writeExportTree } from '../services/export.js';
import {
  assertProfileConfigured,
  findProfileById,
  getSettingsForInternalUse,
  getSettingsLocale,
  profileLabel,
  resolveProfile,
} from '../services/settings.js';
import {
  createSession,
  deleteSession,
  getSession,
  insertMessage,
  listSessions,
  maybeAutoTitleSession,
  updateSession,
} from '../services/sessions.js';
import { getMessageById, latestConversationContactId, resolveRoomTarget } from '../services/room.js';
import {
  afterMeetingAssistantReply,
  askMeetingConfirm,
  assignNextSpeaker,
  clearNextSpeaker,
  insertMeetingVisibleMessage,
  isMeetingActive,
  kickoffMeeting,
  promptHostForNextSpeaker,
  resolveMeetingTarget,
  shouldAutoEndMeeting,
  startMeeting,
  submitMeetingConfirm,
  updateMeetingSpeakGap,
  finalizeMeeting,
  getPendingConfirm,
} from '../services/meeting.js';
import {
  checkMeetingSpeakRate,
  pauseMeetingAuto,
  recordMeetingSpeak,
  resumeMeetingAuto,
} from '../services/meetingRateLimit.js';
import {
  createSideThread,
  deleteThreadSubtree,
  getThread,
  updateThread,
} from '../services/threads.js';
import { streamChatCompletion } from '../lib/openai-client.js';

const createSessionSchema = z.object({
  title: z.string().optional(),
  kind: z.enum(['chat', 'room']).optional(),
  memberContactIds: z.array(z.string().uuid()).optional(),
});

const chatSchema = z.object({
  content: z.string().min(1),
  threadId: z.string().uuid().optional(),
  allowCompress: z.boolean().optional(),
  mentionContactId: z.string().uuid().optional(),
  replyToMessageId: z.string().uuid().optional(),
  allowDefaultTarget: z.boolean().optional(),
});
const exportSchema = z.object({
  path: z.string().optional(),
});

const createThreadSchema = z.object({
  parentThreadId: z.string().uuid(),
  anchorMessageId: z.string().uuid(),
  anchorQuote: z.string().min(1),
  includeUpstream: z.boolean().default(false),
});

const patchThreadSchema = z.object({
  includeInParent: z.boolean().optional(),
  includeAllDescendants: z.boolean().optional(),
  title: z.string().min(1).optional(),
});

function updateSessionSchema(locale: ReturnType<typeof getSettingsLocale>) {
  return z
    .object({
      title: z.string().min(1).optional(),
      model_profile_id: z.string().uuid().nullable().optional(),
      memberContactIds: z.array(z.string().uuid()).optional(),
      returnToSpecified: z.boolean().optional(),
      endMeeting: z.boolean().optional(),
      startMeeting: z
        .object({
          goal: z.string().min(1),
          hostType: z.enum(['user', 'ai']),
          hostContactId: z.string().uuid().optional(),
          maxRounds: z.number().int().min(0).max(200).optional(),
          maxMinutes: z.number().int().min(0).max(180).optional(),
          speakGapSec: z.number().int().min(2).max(120).optional(),
          continueHistory: z.boolean().optional(),
        })
        .optional(),
      pauseMeeting: z.boolean().optional(),
      meetingSpeakGapSec: z.number().int().min(2).max(120).optional(),
    })
    .refine(
      (data) =>
        data.title !== undefined ||
        data.model_profile_id !== undefined ||
        data.memberContactIds !== undefined ||
        data.returnToSpecified !== undefined ||
        data.endMeeting !== undefined ||
        data.startMeeting !== undefined ||
        data.pauseMeeting !== undefined ||
        data.meetingSpeakGapSec !== undefined,
      { message: t(locale, 'session.patchNeedField') },
    );
}

const assignMeetingSchema = z.object({
  nextSpeakerType: z.enum(['user', 'contact']),
  contactId: z.string().uuid().optional(),
});

function writeSse(reply: import('fastify').FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions', async () => listSessions());

  app.post('/api/sessions', async (request, reply) => {
    const locale = getSettingsLocale();
    const parsed = createSessionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      return createSession(parsed.data);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'session.notFound'),
      });
    }
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: t(getSettingsLocale(), 'session.notFound') });
    }
    return session;
  });

  app.get<{
    Params: { id: string };
    Querystring: { threadId?: string };
  }>('/api/sessions/:id/context', async (request, reply) => {
    const locale = getSettingsLocale();
    const session = getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: t(locale, 'session.notFound') });
    }

    const threadId = request.query.threadId ?? session.rootThreadId;
    const thread = getThread(threadId);
    if (!thread || thread.session_id !== session.id) {
      return reply.status(404).send({ error: t(locale, 'thread.notFound') });
    }

    const settings = getSettingsForInternalUse();
    let assembled;
    if (session.kind === 'room') {
      const contactId = latestConversationContactId(session.id);
      const contact = contactId
        ? session.members.find((m) => m.id === contactId) ?? null
        : null;
      assembled = buildRoomContextSnapshot(threadId, settings, contact);
    } else {
      assembled = buildThreadContextSnapshot(threadId, settings);
    }
    // Keep extras aligned with SSE done.context (same ContextSnapshot + overBudget/threadId).
    return {
      ...assembled.snapshot,
      overBudget: assembled.overBudget,
      threadId,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const locale = getSettingsLocale();
    const parsed = updateSessionSchema(locale).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (parsed.data.model_profile_id) {
      if (!findProfileById(parsed.data.model_profile_id)) {
        return reply.status(400).send({ error: t(locale, 'profile.notFound') });
      }
    }

    try {
      const updated = updateSession(request.params.id, {
        title: parsed.data.title,
        model_profile_id: parsed.data.model_profile_id,
        memberContactIds: parsed.data.memberContactIds,
        returnToSpecified: parsed.data.returnToSpecified,
      });
      if (!updated) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }
      if (parsed.data.startMeeting) {
        startMeeting(request.params.id, {
          meetingGoal: parsed.data.startMeeting.goal,
          hostType: parsed.data.startMeeting.hostType,
          hostContactId: parsed.data.startMeeting.hostContactId ?? null,
          meetingMaxRounds: parsed.data.startMeeting.maxRounds,
          meetingMaxMinutes: parsed.data.startMeeting.maxMinutes,
          meetingSpeakGapSec: parsed.data.startMeeting.speakGapSec,
          meetingContinueHistory: parsed.data.startMeeting.continueHistory,
        });
        const kickoff = await kickoffMeeting(request.params.id);
        const detail = getSession(request.params.id);
        if (!detail) return reply.status(404).send({ error: t(locale, 'session.notFound') });
        if (kickoff === 'await_user') {
          return { ...detail, meetingKickoff: 'await_user' };
        }
        return {
          ...detail,
          meetingKickoff: kickoff.shouldEnd ? 'ended' : 'assigned',
          meetingAssignment: kickoff,
        };
      }
      if (parsed.data.endMeeting) {
        await finalizeMeeting(request.params.id, 'user');
      }
      if (parsed.data.pauseMeeting === true) {
        pauseMeetingAuto(request.params.id);
      } else if (parsed.data.pauseMeeting === false) {
        resumeMeetingAuto(request.params.id);
      }
      if (parsed.data.meetingSpeakGapSec !== undefined) {
        updateMeetingSpeakGap(request.params.id, parsed.data.meetingSpeakGapSec);
      }
      const detail = getSession(request.params.id);
      return detail ?? updated;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'session.notFound'),
      });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const deleted = deleteSession(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: t(getSettingsLocale(), 'session.notFound') });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/meeting/assign',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }
      if (!isMeetingActive(session)) {
        return reply.status(400).send({ error: t(locale, 'meeting.notActive') });
      }

      const parsed = assignMeetingSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        assignNextSpeaker(session.id, {
          nextSpeakerType: parsed.data.nextSpeakerType,
          contactId: parsed.data.contactId ?? null,
        });
        if (parsed.data.nextSpeakerType === 'contact' && parsed.data.contactId) {
          const name =
            session.members.find((m) => m.id === parsed.data.contactId)?.name ?? '?';
          insertMeetingVisibleMessage({
            sessionId: session.id,
            role: 'user',
            content: t(locale, 'meeting.userHostSayContact', { name }),
            targetContactId: parsed.data.contactId,
          });
        } else {
          insertMeetingVisibleMessage({
            sessionId: session.id,
            role: 'user',
            content: t(locale, 'meeting.userHostSayUser'),
          });
        }
        return getSession(session.id);
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : t(locale, 'meeting.notActive'),
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/meeting/resume',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }
      if (!isMeetingActive(session)) {
        return reply.status(400).send({ error: t(locale, 'meeting.notActive') });
      }
      if (getPendingConfirm(session.id)) {
        return reply.status(400).send({ error: t(locale, 'meeting.confirmPending') });
      }
      resumeMeetingAuto(session.id);
      return getSession(session.id);
    },
  );

  const askConfirmSchema = z.object({
    title: z.string().min(1).max(120),
    prompt: z.string().min(1).max(500),
    options: z.array(z.object({ id: z.string().optional(), label: z.string().min(1).max(200) })).min(2).max(6),
    allowRating: z.boolean().optional(),
  });

  const submitConfirmSchema = z.object({
    selectedIds: z.array(z.string().min(1)).min(1),
    ratings: z.record(z.string(), z.number().int().min(1).max(5)).optional(),
    comment: z.string().max(1000).optional(),
  });

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/meeting/confirm/ask',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const parsed = askConfirmSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      try {
        askMeetingConfirm(request.params.id, parsed.data);
        return getSession(request.params.id);
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : t(locale, 'meeting.notActive'),
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/meeting/confirm',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const parsed = submitConfirmSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      try {
        submitMeetingConfirm(request.params.id, parsed.data);
        const current = getSession(request.params.id);
        if (current?.host_type === 'ai' && current.meeting_status === 'active') {
          await kickoffMeeting(current.id);
        }
        return getSession(request.params.id);
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : t(locale, 'meeting.notActive'),
        });
      }
    },
  );

  app.post<{ Params: { id: string }; Querystring: { afterHostAssign?: string } }>(
    '/api/sessions/:id/meeting/speak',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }
      if (!isMeetingActive(session)) {
        return reply.status(400).send({ error: t(locale, 'meeting.notActive') });
      }
      if (getPendingConfirm(session.id)) {
        return reply.status(400).send({ error: t(locale, 'meeting.confirmPending') });
      }
      if (
        session.next_speaker_type !== 'contact' ||
        !session.next_speaker_contact_id
      ) {
        return reply.status(400).send({ error: t(locale, 'meeting.noSpeaker') });
      }

      const afterHostAssign =
        request.query.afterHostAssign === '1' || request.query.afterHostAssign === 'true';
      const rate = checkMeetingSpeakRate(session.id, { afterHostAssign });
      if (!rate.ok) {
        const message =
          rate.code === 'meeting_paused'
            ? t(locale, 'meeting.paused')
            : rate.code === 'meeting_rate_limited'
              ? t(locale, 'meeting.rateLimited')
              : t(locale, 'meeting.tooFast');
        return reply.status(429).send({
          error: message,
          code: rate.code,
          message,
          retryAfterMs: rate.retryAfterMs,
        });
      }

      const threadId = session.rootThreadId;
      const thread = getThread(threadId);
      if (!thread || thread.session_id !== session.id) {
        return reply.status(404).send({ error: t(locale, 'thread.notFound') });
      }

      const contact = session.members.find((m) => m.id === session.next_speaker_contact_id);
      if (!contact) {
        return reply.status(400).send({ error: t(locale, 'room.memberNotFound') });
      }

      // Consume assignment so reload / auto-speak cannot re-trigger the same turn.
      clearNextSpeaker(session.id);
      recordMeetingSpeak(session.id);

      const found = findProfileById(contact.model_profile_id);
      if (!found) {
        return reply.status(400).send({ error: t(locale, 'profile.notFound') });
      }

      let profile;
      try {
        profile = assertProfileConfigured(found);
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : t(locale, 'profile.invalid'),
        });
      }

      const appSettings = getSettingsForInternalUse();
      const settings = {
        ...appSettings,
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        model: profile.model,
      };

      if (shouldAutoEndMeeting(session)) {
        await finalizeMeeting(session.id, 'limit');
        return reply.status(400).send({ error: t(locale, 'meeting.ended') });
      }

      const prepared = prepareMeetingSpeakMessages({
        threadId,
        settings,
        contact,
        meetingGoal: session.meeting_goal ?? '',
        sinceCreatedAt:
          session.meeting_continue_history === 0 ? session.meeting_started_at : null,
      });

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let assistantContent = '';
      try {
        for await (const delta of streamChatCompletion({
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          model: profile.model,
          messages: prepared.selected,
        })) {
          assistantContent += delta;
          writeSse(reply, { type: 'delta', content: delta });
        }

        const assistantMessage = insertMessage({
          sessionId: session.id,
          threadId,
          role: 'assistant',
          content: assistantContent,
          modelProfileId: profile.id,
          modelLabel: profileLabel(profile),
          contactId: contact.id,
        });

        await afterMeetingAssistantReply(session.id, (payload) => writeSse(reply, payload), {
          content: assistantContent,
          contactId: contact.id,
        });

        writeSse(reply, {
          type: 'done',
          messageId: assistantMessage.id,
          content: assistantContent,
          context: {
            ...prepared.snapshot,
            overBudget: false,
            threadId,
          },
          targetContactId: contact.id,
        });
      } catch (error) {
        writeSse(reply, {
          type: 'error',
          message: error instanceof Error ? error.message : t(locale, 'chat.failed'),
        });
      } finally {
        reply.raw.end();
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/threads',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }
      if (session.kind === 'room') {
        return reply.status(400).send({ error: t(locale, 'room.noBypass') });
      }

      const parsed = createThreadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const thread = createSideThread({
          sessionId: session.id,
          parentThreadId: parsed.data.parentThreadId,
          anchorMessageId: parsed.data.anchorMessageId,
          anchorQuote: parsed.data.anchorQuote,
          includeUpstream: parsed.data.includeUpstream,
        });
        return thread;
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : t(locale, 'thread.createFailed'),
        });
      }
    },
  );

  app.patch<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
    const locale = getSettingsLocale();
    const parsed = patchThreadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = updateThread(request.params.id, parsed.data);
      if (!updated) {
        return reply.status(404).send({ error: t(locale, 'thread.notFound') });
      }
      return updated;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'thread.updateFailed'),
      });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
    const locale = getSettingsLocale();
    try {
      const deleted = deleteThreadSubtree(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: t(locale, 'thread.notFound') });
      }
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'thread.deleteFailed'),
      });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/chat',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const parsed = chatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }

      const threadId = parsed.data.threadId ?? session.rootThreadId;
      const thread = getThread(threadId);
      if (!thread || thread.session_id !== session.id) {
        return reply.status(404).send({ error: t(locale, 'thread.notFound') });
      }

      if (session.kind === 'room') {
        if (session.room_mode === 'meeting' && session.meeting_status === 'ended') {
          return reply.status(400).send({ error: t(locale, 'meeting.ended') });
        }

        const meetingActive = isMeetingActive(session);
        const memberIds = new Set(session.members.map((m) => m.id));

        const targetContactId = meetingActive
          ? resolveMeetingTarget({
              session,
              mentionContactId: parsed.data.mentionContactId,
              replyToMessageId: parsed.data.replyToMessageId,
              memberIds,
              resolveQuote: (replyId) =>
                resolveRoomTarget({
                  sessionId: session.id,
                  replyToMessageId: replyId,
                  allowDefaultTarget: false,
                }),
            })
          : resolveRoomTarget({
              sessionId: session.id,
              mentionContactId: parsed.data.mentionContactId,
              replyToMessageId: parsed.data.replyToMessageId,
              allowDefaultTarget: parsed.data.allowDefaultTarget,
            });

        let quoteExcerpt: string | null = null;
        if (parsed.data.replyToMessageId) {
          const quoted = getMessageById(parsed.data.replyToMessageId);
          if (quoted && quoted.session_id === session.id) {
            quoteExcerpt = quoted.content.slice(0, 500);
          }
        }

        insertMessage({
          sessionId: session.id,
          threadId,
          role: 'user',
          content: parsed.data.content,
          targetContactId,
          replyToMessageId: parsed.data.replyToMessageId ?? null,
        });
        maybeAutoTitleSession(session.id, parsed.data.content);

        if (!targetContactId) {
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          writeSse(reply, { type: 'noop', reason: 'no_target' });
          if (meetingActive) {
            await promptHostForNextSpeaker(session.id, (payload) => writeSse(reply, payload));
          }
          writeSse(reply, { type: 'done', noop: true });
          reply.raw.end();
          return;
        }

        const contact = session.members.find((m) => m.id === targetContactId);
        if (!contact) {
          return reply.status(400).send({ error: t(locale, 'room.memberNotFound') });
        }

        const found = findProfileById(contact.model_profile_id);
        if (!found) {
          return reply.status(400).send({ error: t(locale, 'profile.notFound') });
        }

        let profile;
        try {
          profile = assertProfileConfigured(found);
        } catch (error) {
          return reply.status(400).send({
            error: error instanceof Error ? error.message : t(locale, 'profile.invalid'),
          });
        }

        const appSettings = getSettingsForInternalUse();
        const settings = {
          ...appSettings,
          apiKey: profile.apiKey,
          baseUrl: profile.baseUrl,
          model: profile.model,
        };

        const prepared = prepareRoomChatMessages({
          threadId,
          settings,
          contact,
          pendingUserContent: parsed.data.content,
          quoteExcerpt,
        });

        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        let assistantContent = '';
        try {
          for await (const delta of streamChatCompletion({
            baseUrl: profile.baseUrl,
            apiKey: profile.apiKey,
            model: profile.model,
            messages: prepared.selected,
          })) {
            assistantContent += delta;
            writeSse(reply, { type: 'delta', content: delta });
          }

          const assistantMessage = insertMessage({
            sessionId: session.id,
            threadId,
            role: 'assistant',
            content: assistantContent,
            modelProfileId: profile.id,
            modelLabel: profileLabel(profile),
            contactId: contact.id,
          });

          if (meetingActive) {
            await afterMeetingAssistantReply(session.id, (payload) => writeSse(reply, payload), {
              content: assistantContent,
              contactId: contact.id,
            });
          }

          writeSse(reply, {
            type: 'done',
            messageId: assistantMessage.id,
            content: assistantContent,
            context: {
              ...prepared.snapshot,
              overBudget: false,
              threadId,
            },
            targetContactId: contact.id,
          });
        } catch (error) {
          writeSse(reply, {
            type: 'error',
            message: error instanceof Error ? error.message : t(locale, 'chat.failed'),
          });
        } finally {
          reply.raw.end();
        }
        return;
      }

      const appSettings = getSettingsForInternalUse();
      let profile;
      try {
        profile = assertProfileConfigured(resolveProfile(session.model_profile_id));
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : t(locale, 'profile.invalid'),
        });
      }

      // Overlay resolved profile credentials for compress + sliding-window path.
      const settings = {
        ...appSettings,
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        model: profile.model,
      };

      // Assemble + overflow/compress once before persist — reuse selected for upstream
      // (avoids double LLM compress and orphan user rows if a second prepare failed).
      const prepared = await prepareChatMessages({
        threadId,
        settings,
        pendingUserContent: parsed.data.content,
        allowCompress: parsed.data.allowCompress,
      });

      if (!prepared.ok) {
        return reply.status(409).send({
          error: 'context_overflow',
          code: 'context_overflow',
          message: t(locale, 'chat.contextOverflow'),
          context: {
            ...prepared.snapshot,
            overBudget: true,
            threadId,
          },
        });
      }

      insertMessage({
        sessionId: session.id,
        threadId,
        role: 'user',
        content: parsed.data.content,
      });
      if (thread.parent_thread_id === null) {
        maybeAutoTitleSession(session.id, parsed.data.content);
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let assistantContent = '';

      try {
        for await (const delta of streamChatCompletion({
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          model: profile.model,
          messages: prepared.selected.map(({ role, content }) => ({ role, content })),
        })) {
          assistantContent += delta;
          writeSse(reply, { type: 'delta', content: delta });
        }

        const assistantMessage = insertMessage({
          sessionId: session.id,
          threadId,
          role: 'assistant',
          content: assistantContent,
          modelProfileId: profile.id,
          modelLabel: profileLabel(profile),
        });

        const after = buildThreadContextSnapshot(threadId, settings);

        writeSse(reply, {
          type: 'done',
          messageId: assistantMessage.id,
          content: assistantContent,
          // Match GET /context shape so FE overBudget banner stays correct after send.
          context: {
            ...after.snapshot,
            overBudget: after.overBudget,
            threadId,
          },
        });
      } catch (error) {
        writeSse(reply, {
          type: 'error',
          message: error instanceof Error ? error.message : t(locale, 'chat.failed'),
          context: {
            ...prepared.snapshot,
            overBudget: false,
            threadId,
          },
        });
      } finally {
        reply.raw.end();
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/export',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const parsed = exportSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
      }

      const settings = getSettingsForInternalUse();
      if (settings.exportAskEachTime && !parsed.data.path?.trim()) {
        return reply.status(400).send({ error: t(locale, 'export.pathRequired') });
      }

      const rootDir = resolveExportPath({
        session,
        exportDir: settings.exportDir,
        customPath: parsed.data.path,
      });

      const resolved = resolveProfile(session.model_profile_id);

      try {
        const writtenPath = writeExportTree({
          rootDir,
          session,
          threadTree: session.threadTree,
          model: resolved.model,
          modelProfileName: profileLabel(resolved),
        });
        return { path: writtenPath };
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : t(locale, 'export.failed'),
        });
      }
    },
  );
}
