import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '../i18n/index.js';
import {
  prepareChatMessages,
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
import {
  createSideThread,
  deleteThreadSubtree,
  getThread,
  updateThread,
} from '../services/threads.js';
import { streamChatCompletion } from '../lib/openai-client.js';

const createSessionSchema = z.object({
  title: z.string().optional(),
});

const chatSchema = z.object({
  content: z.string().min(1),
  threadId: z.string().uuid().optional(),
  allowCompress: z.boolean().optional(),
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
    })
    .refine(
      (data) => data.title !== undefined || data.model_profile_id !== undefined,
      { message: t(locale, 'session.patchNeedField') },
    );
}

function writeSse(reply: import('fastify').FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions', async () => listSessions());

  app.post('/api/sessions', async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return createSession(parsed.data.title);
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
    const assembled = buildThreadContextSnapshot(threadId, settings);
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

    const updated = updateSession(request.params.id, {
      title: parsed.data.title,
      model_profile_id: parsed.data.model_profile_id,
    });
    if (!updated) {
      return reply.status(404).send({ error: t(locale, 'session.notFound') });
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const deleted = deleteSession(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: t(getSettingsLocale(), 'session.notFound') });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/threads',
    async (request, reply) => {
      const locale = getSettingsLocale();
      const session = getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: t(locale, 'session.notFound') });
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
