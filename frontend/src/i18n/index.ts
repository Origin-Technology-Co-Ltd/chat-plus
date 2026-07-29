import { en } from './en';
import { zh } from './zh';
import type { Locale, MessageKey } from './types';

export type { Locale, MessageKey };

const catalogs = { en, zh } as const;

let runtimeLocale: Locale = 'en';

export function setRuntimeLocale(locale: Locale): void {
  runtimeLocale = locale;
}

export function getRuntimeLocale(): Locale {
  return runtimeLocale;
}

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

export function resolveFromEnv(languages: readonly string[]): Locale {
  for (const tag of languages) {
    if (tag.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let text = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Translate using the app's current runtime locale (for non-React modules). */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return translate(runtimeLocale, key, params);
}
