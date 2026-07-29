import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '../i18n/index.js';
import { getSettings, getSettingsLocale, updateSettings } from '../services/settings.js';

const profileInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
});

const updateSettingsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  exportDir: z.string().optional(),
  exportAskEachTime: z.boolean().optional(),
  contextWindow: z.number().int().min(1024).optional(),
  contextAutoTrim: z.boolean().optional(),
  contextKeepRounds: z.number().int().min(1).optional(),
  contextTargetRatio: z.number().min(0.1).max(1).optional(),
  locale: z.enum(['en', 'zh']).optional(),
  profiles: z.array(profileInputSchema).min(1).optional(),
  defaultProfileId: z.string().uuid().optional(),
});

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => getSettings());

  app.put('/api/settings', async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const payload = { ...parsed.data };
    if (payload.apiKey !== undefined && payload.apiKey.includes('*')) {
      delete payload.apiKey;
    }
    if (payload.profiles) {
      payload.profiles = payload.profiles.map((profile) => {
        if (profile.apiKey !== undefined && profile.apiKey.includes('*')) {
          const { apiKey: _masked, ...rest } = profile;
          return rest;
        }
        return profile;
      });
    }

    try {
      return updateSettings(payload);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : t(getSettingsLocale(), 'settings.saveFailed'),
      });
    }
  });
}
