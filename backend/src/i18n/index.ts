import { messages, type Locale, type MessageKey } from './messages.js';

export type { Locale, MessageKey };

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

/** Invalid / missing → en (API errors when locale unset). */
export function resolveLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : 'en';
}

export function t(
  locale: Locale | null | undefined,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const lang = resolveLocale(locale);
  let text = messages[lang][key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Both locale default titles (legacy zh + current). */
export function isDefaultSessionTitle(title: string): boolean {
  return title === messages.en['session.newChat'] || title === messages.zh['session.newChat'];
}
