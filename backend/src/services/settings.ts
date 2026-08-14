import { getDb } from '../db/init.js';
import { isLocale, resolveLocale, t, type Locale } from '../i18n/index.js';
import { defaultExportDir } from '../lib/paths.js';

export type { Locale };

export type ModelProfile = {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type ModelProfilePublic = {
  id: string;
  name: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  baseUrl: string;
  model: string;
};

export type AppSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  exportDir: string;
  exportAskEachTime: boolean;
  contextWindow: number;
  contextAutoTrim: boolean;
  contextKeepRounds: number;
  contextTargetRatio: number;
  /** null = never initialized; API returns null until first write. */
  locale: Locale | null;
  profiles: ModelProfile[];
  defaultProfileId: string;
};

export type SettingsPublic = Omit<AppSettings, 'apiKey' | 'profiles'> & {
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

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  exportDir: defaultExportDir(),
  exportAskEachTime: false,
  contextWindow: 128000,
  contextAutoTrim: true,
  contextKeepRounds: 20,
  contextTargetRatio: 0.7,
};

const FLAT_KEY_MAP = {
  apiKey: 'api_key',
  baseUrl: 'base_url',
  model: 'model',
  exportDir: 'export_dir',
  exportAskEachTime: 'export_ask_each_time',
  contextWindow: 'context_window',
  contextAutoTrim: 'context_auto_trim',
  contextKeepRounds: 'context_keep_rounds',
  contextTargetRatio: 'context_target_ratio',
  locale: 'locale',
} as const;

function readStoredLocale(raw: string | undefined): Locale | null {
  if (raw === undefined) return null;
  return isLocale(raw) ? raw : null;
}

/** Effective locale for user-visible API strings (null → en). */
export function getSettingsLocale(): Locale {
  return resolveLocale(getSettingsForInternalUse().locale);
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 4) return '****';
  return `${'*'.repeat(Math.max(apiKey.length - 4, 4))}${apiKey.slice(-4)}`;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function upsertSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

function toPublicProfile(profile: ModelProfile): ModelProfilePublic {
  return {
    id: profile.id,
    name: profile.name,
    apiKeyMasked: maskApiKey(profile.apiKey),
    hasApiKey: Boolean(profile.apiKey),
    baseUrl: profile.baseUrl,
    model: profile.model,
  };
}

function parseProfilesJson(
  raw: string | undefined,
  locale: Locale | null,
): ModelProfile[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const profiles: ModelProfile[] = [];
    const fallbackName = t(resolveLocale(locale), 'profile.defaultName');
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : '';
      const name = typeof row.name === 'string' ? row.name : '';
      const apiKey = typeof row.apiKey === 'string' ? row.apiKey : '';
      const baseUrl = typeof row.baseUrl === 'string' ? row.baseUrl : DEFAULTS.baseUrl;
      const model = typeof row.model === 'string' ? row.model : '';
      if (!id) continue;
      profiles.push({ id, name: name || model || fallbackName, apiKey, baseUrl, model });
    }
    return profiles.length > 0 ? profiles : null;
  } catch {
    return null;
  }
}

function mirrorDefaultToFlatKeys(profile: ModelProfile): void {
  upsertSetting('api_key', profile.apiKey);
  upsertSetting('base_url', profile.baseUrl);
  upsertSetting('model', profile.model);
}

function persistProfiles(profiles: ModelProfile[], defaultProfileId: string): void {
  upsertSetting('model_profiles', JSON.stringify(profiles));
  upsertSetting('default_model_profile_id', defaultProfileId);
  const defaultProfile =
    profiles.find((p) => p.id === defaultProfileId) ?? profiles[0];
  if (defaultProfile) mirrorDefaultToFlatKeys(defaultProfile);
}

function ensureProfiles(
  stored: Record<string, string>,
): { profiles: ModelProfile[]; defaultProfileId: string } {
  const locale = readStoredLocale(stored.locale);
  const existing = parseProfilesJson(stored.model_profiles, locale);
  if (existing) {
    let defaultProfileId = stored.default_model_profile_id ?? '';
    if (!existing.some((p) => p.id === defaultProfileId)) {
      defaultProfileId = existing[0].id;
      upsertSetting('default_model_profile_id', defaultProfileId);
    }
    // Keep flat keys mirrored for rollback safety.
    const def = existing.find((p) => p.id === defaultProfileId) ?? existing[0];
    mirrorDefaultToFlatKeys(def);
    return { profiles: existing, defaultProfileId };
  }

  // Migrate legacy flat triple into the first profile (idempotent).
  const apiKey = stored.api_key ?? DEFAULTS.apiKey;
  const baseUrl = stored.base_url ?? DEFAULTS.baseUrl;
  const model = stored.model ?? DEFAULTS.model;
  const id = crypto.randomUUID();
  const profile: ModelProfile = {
    id,
    name: model.trim() || t(resolveLocale(locale), 'profile.defaultName'),
    apiKey,
    baseUrl,
    model,
  };
  persistProfiles([profile], id);
  return { profiles: [profile], defaultProfileId: id };
}

function loadStoredMap(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function getSettingsForInternalUse(): AppSettings {
  const stored = loadStoredMap();
  const { profiles, defaultProfileId } = ensureProfiles(stored);
  const defaultProfile =
    profiles.find((p) => p.id === defaultProfileId) ?? profiles[0];

  return {
    apiKey: defaultProfile?.apiKey ?? DEFAULTS.apiKey,
    baseUrl: defaultProfile?.baseUrl ?? DEFAULTS.baseUrl,
    model: defaultProfile?.model ?? DEFAULTS.model,
    exportDir: stored.export_dir ?? DEFAULTS.exportDir,
    exportAskEachTime: (stored.export_ask_each_time ?? 'false') === 'true',
    contextWindow: parseNumber(stored.context_window, DEFAULTS.contextWindow),
    contextAutoTrim: (stored.context_auto_trim ?? 'true') === 'true',
    contextKeepRounds: parseNumber(stored.context_keep_rounds, DEFAULTS.contextKeepRounds),
    contextTargetRatio: parseNumber(stored.context_target_ratio, DEFAULTS.contextTargetRatio),
    locale: readStoredLocale(stored.locale),
    profiles,
    defaultProfileId,
  };
}

export function getSettings(): SettingsPublic {
  const settings = getSettingsForInternalUse();
  const defaultProfile =
    settings.profiles.find((p) => p.id === settings.defaultProfileId) ??
    settings.profiles[0];

  return {
    baseUrl: defaultProfile?.baseUrl ?? settings.baseUrl,
    model: defaultProfile?.model ?? settings.model,
    exportDir: settings.exportDir,
    exportAskEachTime: settings.exportAskEachTime,
    contextWindow: settings.contextWindow,
    contextAutoTrim: settings.contextAutoTrim,
    contextKeepRounds: settings.contextKeepRounds,
    contextTargetRatio: settings.contextTargetRatio,
    locale: settings.locale,
    apiKeyMasked: maskApiKey(defaultProfile?.apiKey ?? ''),
    hasApiKey: Boolean(defaultProfile?.apiKey),
    profiles: settings.profiles.map(toPublicProfile),
    defaultProfileId: settings.defaultProfileId,
  };
}

export function resolveProfile(sessionModelProfileId: string | null | undefined): ModelProfile {
  const settings = getSettingsForInternalUse();
  if (sessionModelProfileId) {
    const found = settings.profiles.find((p) => p.id === sessionModelProfileId);
    if (found) return found;
  }
  const fallback =
    settings.profiles.find((p) => p.id === settings.defaultProfileId) ??
    settings.profiles[0];
  if (!fallback) {
    throw new Error(t(getSettingsLocale(), 'profile.noneConfigured'));
  }
  return fallback;
}

export function profileLabel(profile: ModelProfile): string {
  return profile.name.trim() || profile.model.trim() || profile.id;
}

export function assertProfileConfigured(profile: ModelProfile): ModelProfile {
  const locale = getSettingsLocale();
  if (!profile.apiKey.trim()) {
    throw new Error(t(locale, 'profile.apiKeyMissing'));
  }
  if (!profile.model.trim()) {
    throw new Error(t(locale, 'profile.modelMissing'));
  }
  return profile;
}

/** @deprecated Prefer assertProfileConfigured(resolveProfile(...)) */
export function assertChatConfigured(): AppSettings {
  const settings = getSettingsForInternalUse();
  const profile = resolveProfile(null);
  assertProfileConfigured(profile);
  return settings;
}

export function updateSettings(input: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  exportDir?: string;
  exportAskEachTime?: boolean;
  contextWindow?: number;
  contextAutoTrim?: boolean;
  contextKeepRounds?: number;
  contextTargetRatio?: number;
  locale?: Locale;
  profiles?: ProfileInput[];
  defaultProfileId?: string;
}): SettingsPublic {
  const current = getSettingsForInternalUse();
  const localeForErrors = resolveLocale(input.locale ?? current.locale);

  let nextExportDir = input.exportDir ?? current.exportDir;
  let nextExportAsk = input.exportAskEachTime ?? current.exportAskEachTime;
  let nextWindow = input.contextWindow ?? current.contextWindow;
  let nextAutoTrim = input.contextAutoTrim ?? current.contextAutoTrim;
  let nextKeepRounds = input.contextKeepRounds ?? current.contextKeepRounds;
  let nextRatio = input.contextTargetRatio ?? current.contextTargetRatio;
  let nextLocale = current.locale;

  if (nextWindow < 1024) nextWindow = 1024;
  if (nextKeepRounds < 1) nextKeepRounds = 1;
  if (nextRatio < 0.1) nextRatio = 0.1;
  if (nextRatio > 1) nextRatio = 1;
  if (input.locale !== undefined) {
    if (!isLocale(input.locale)) {
      throw new Error(t(localeForErrors, 'profile.invalid'));
    }
    nextLocale = input.locale;
  }

  upsertSetting(FLAT_KEY_MAP.exportDir, nextExportDir);
  upsertSetting(FLAT_KEY_MAP.exportAskEachTime, nextExportAsk ? 'true' : 'false');
  upsertSetting(FLAT_KEY_MAP.contextWindow, String(nextWindow));
  upsertSetting(FLAT_KEY_MAP.contextAutoTrim, nextAutoTrim ? 'true' : 'false');
  upsertSetting(FLAT_KEY_MAP.contextKeepRounds, String(nextKeepRounds));
  upsertSetting(FLAT_KEY_MAP.contextTargetRatio, String(nextRatio));
  if (nextLocale !== null) {
    upsertSetting(FLAT_KEY_MAP.locale, nextLocale);
  }

  let profiles = current.profiles;
  let defaultProfileId = current.defaultProfileId;

  if (input.profiles !== undefined) {
    if (input.profiles.length < 1) {
      throw new Error(t(localeForErrors, 'profile.keepAtLeastOne'));
    }

    const byId = new Map(current.profiles.map((p) => [p.id, p]));
    const nextProfiles: ModelProfile[] = [];

    for (const item of input.profiles) {
      const existing = item.id ? byId.get(item.id) : undefined;
      const id = existing?.id ?? item.id ?? crypto.randomUUID();
      const submittedKey = item.apiKey?.trim() ?? '';
      const keepKey =
        !submittedKey || submittedKey.includes('*')
          ? (existing?.apiKey ?? '')
          : submittedKey;

      nextProfiles.push({
        id,
        name: item.name.trim() || item.model.trim() || t(localeForErrors, 'profile.unnamed'),
        apiKey: keepKey,
        baseUrl: item.baseUrl.trim() || DEFAULTS.baseUrl,
        model: item.model.trim(),
      });
    }

    profiles = nextProfiles;
    defaultProfileId =
      input.defaultProfileId && profiles.some((p) => p.id === input.defaultProfileId)
        ? input.defaultProfileId
        : profiles[0].id;
  } else if (input.defaultProfileId) {
    if (!profiles.some((p) => p.id === input.defaultProfileId)) {
      throw new Error(t(localeForErrors, 'profile.defaultNotFound'));
    }
    defaultProfileId = input.defaultProfileId;
  } else if (
    input.apiKey !== undefined ||
    input.baseUrl !== undefined ||
    input.model !== undefined
  ) {
    // Legacy flat-field update: patch the default profile.
    const idx = profiles.findIndex((p) => p.id === defaultProfileId);
    const targetIdx = idx >= 0 ? idx : 0;
    const target = profiles[targetIdx];
    if (target) {
      const nextKey =
        input.apiKey !== undefined && input.apiKey.trim() && !input.apiKey.includes('*')
          ? input.apiKey.trim()
          : target.apiKey;
      profiles = profiles.map((p, i) =>
        i === targetIdx
          ? {
              ...p,
              apiKey: nextKey,
              baseUrl: input.baseUrl?.trim() || p.baseUrl,
              model: input.model?.trim() || p.model,
              name: p.name || input.model?.trim() || p.model,
            }
          : p,
      );
    }
  }

  if (input.defaultProfileId && profiles.some((p) => p.id === input.defaultProfileId)) {
    defaultProfileId = input.defaultProfileId;
  }
  if (!profiles.some((p) => p.id === defaultProfileId)) {
    defaultProfileId = profiles[0]?.id ?? defaultProfileId;
  }

  persistProfiles(profiles, defaultProfileId);
  return getSettings();
}

export function findProfileById(id: string): ModelProfile | undefined {
  return getSettingsForInternalUse().profiles.find((p) => p.id === id);
}
