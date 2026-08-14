import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '../i18n/index.js';
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
} from '../services/contacts.js';
import { getSettingsLocale } from '../services/settings.js';

const createSchema = z.object({
  name: z.string().min(1),
  modelProfileId: z.string().uuid(),
  personalityPrompt: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  modelProfileId: z.string().uuid().optional(),
  personalityPrompt: z.string().optional(),
});

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/contacts', async () => listContacts());

  app.get<{ Params: { id: string } }>('/api/contacts/:id', async (request, reply) => {
    const contact = getContact(request.params.id);
    if (!contact) {
      return reply.status(404).send({ error: t(getSettingsLocale(), 'contact.notFound') });
    }
    return contact;
  });

  app.post('/api/contacts', async (request, reply) => {
    const locale = getSettingsLocale();
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      return createContact(parsed.data);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'contact.saveFailed'),
      });
    }
  });

  app.put<{ Params: { id: string } }>('/api/contacts/:id', async (request, reply) => {
    const locale = getSettingsLocale();
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      const updated = updateContact(request.params.id, parsed.data);
      if (!updated) {
        return reply.status(404).send({ error: t(locale, 'contact.notFound') });
      }
      return updated;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'contact.saveFailed'),
      });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/contacts/:id', async (request, reply) => {
    const locale = getSettingsLocale();
    try {
      const deleted = deleteContact(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: t(locale, 'contact.notFound') });
      }
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(locale, 'contact.deleteFailed'),
      });
    }
  });
}
