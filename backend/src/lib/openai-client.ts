import { t } from '../i18n/index.js';
import { getSettingsLocale } from '../services/settings.js';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export async function* streamChatCompletion(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): AsyncGenerator<string> {
  const base = options.baseUrl.replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const locale = getSettingsLocale();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      t(locale, 'upstream.modelError', { status: response.status, detail: text }),
    );
  }

  if (!response.body) {
    throw new Error(t(locale, 'upstream.noBody'));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

/** Non-streaming completion — used for ephemeral bypass compress. */
export async function chatCompletion(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): Promise<string> {
  const base = options.baseUrl.replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const locale = getSettingsLocale();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      t(locale, 'upstream.modelError', { status: response.status, detail: text }),
    );
  }

  const parsed = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsed.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error(t(locale, 'upstream.emptySummary'));
  }
  return content.trim();
}
