import type { MessageRow, ThreadRow } from '../db/init.js';
import { resolveLocale, t, type Locale } from '../i18n/index.js';
import { chatCompletion } from '../lib/openai-client.js';
import type { AppSettings } from './settings.js';
import { getSettingsLocale } from './settings.js';
import {
  buildContextSnapshot,
  buildSlidingWindow,
  estimateMessagesTokens,
  type ChatRoleMessage,
  type ContextSettings,
  type ContextSnapshot,
} from './context.js';
import {
  getThread,
  getThreadMessages,
  listIncludedChildThreads,
  listThreadsForSession,
} from './threads.js';

function localeOf(settings: AppSettings): Locale {
  return resolveLocale(settings.locale);
}

export type AssembledContext = {
  messages: ChatRoleMessage[];
  overBudget: boolean;
  fullTokens: number;
  window: number;
  snapshot: ContextSnapshot;
  upstreamCount: number;
};

function toRoleMessages(rows: MessageRow[]): ChatRoleMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
  }));
}

function contextSettingsFromApp(settings: AppSettings): ContextSettings {
  return {
    contextWindow: settings.contextWindow,
    contextAutoTrim: settings.contextAutoTrim,
    contextKeepRounds: settings.contextKeepRounds,
    contextTargetRatio: settings.contextTargetRatio,
  };
}

/** Parent messages up to and including the anchor message. */
function parentUpstreamThroughAnchor(
  parentThreadId: string,
  anchorMessageId: string | null,
): ChatRoleMessage[] {
  const rows = getThreadMessages(parentThreadId);
  if (!anchorMessageId) return toRoleMessages(rows);
  const index = rows.findIndex((row) => row.id === anchorMessageId);
  if (index < 0) return toRoleMessages(rows);
  return toRoleMessages(rows.slice(0, index + 1));
}

function childBlock(
  thread: ThreadRow,
  messages: MessageRow[],
  locale: Locale,
): ChatRoleMessage {
  const quote = thread.anchor_quote?.trim() || thread.title;
  const body = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n');
  return {
    role: 'system',
    content: t(locale, 'assemble.bypassInclude', {
      title: thread.title,
      quote,
      body: body || t(locale, 'assemble.noBypassMessages'),
    }),
  };
}

/** Merge bypass selection into the first user turn (DB/UI keep raw text). */
function withAnchorOnFirstUser(
  messages: ChatRoleMessage[],
  anchorQuote: string | null | undefined,
  locale: Locale,
): ChatRoleMessage[] {
  const quote = anchorQuote?.trim();
  if (!quote) return messages;

  const index = messages.findIndex((m) => m.role === 'user');
  if (index < 0) return messages;

  const first = messages[index]!;
  const next = messages.slice();
  next[index] = {
    ...first,
    content: t(locale, 'assemble.aboutQuote', { quote, content: first.content }),
  };
  return next;
}

/** Parent upstream (optional) + own pane, with selection folded into first user message. */
function ownPaneWithOptionalUpstream(
  thread: ThreadRow,
  locale: Locale,
  extraUserContent?: string,
): { upstream: ChatRoleMessage[]; own: ChatRoleMessage[] } {
  const upstream: ChatRoleMessage[] = [];

  if (thread.include_upstream && thread.parent_thread_id) {
    upstream.push(
      ...parentUpstreamThroughAnchor(thread.parent_thread_id, thread.anchor_message_id),
    );
  }

  const own = toRoleMessages(getThreadMessages(thread.id));
  if (extraUserContent?.trim()) {
    own.push({ role: 'user', content: extraUserContent.trim() });
  }

  const framed =
    thread.parent_thread_id != null
      ? withAnchorOnFirstUser(own, thread.anchor_quote, locale)
      : own;

  return { upstream, own: framed };
}

export type AssembledParts = {
  messages: ChatRoleMessage[];
  /** Length of parent-upstream prefix protected from sliding-window keepRounds. */
  upstreamCount: number;
};

/**
 * Assemble send context for thread T:
 * optional parent upstream (to anchor) + own messages (quote on first user) + included descendants.
 */
export function assembleThreadMessages(
  threadId: string,
  extraUserContent?: string,
): ChatRoleMessage[] {
  return assembleThreadParts(threadId, extraUserContent).messages;
}

export function assembleThreadParts(
  threadId: string,
  extraUserContent?: string,
): AssembledParts {
  const thread = getThread(threadId);
  const locale = getSettingsLocale();
  if (!thread) throw new Error(t(locale, 'thread.notFound'));

  const all = listThreadsForSession(thread.session_id);
  const { upstream, own } = ownPaneWithOptionalUpstream(thread, locale, extraUserContent);
  const assembled = [...upstream, ...own];

  const included = listIncludedChildThreads(thread, all);
  // Deduplicate while preserving order (listIncluded may nest)
  const seen = new Set<string>();
  for (const child of included) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    assembled.push(childBlock(child, getThreadMessages(child.id), locale));
  }

  return { messages: assembled, upstreamCount: upstream.length };
}

export function buildThreadContextSnapshot(
  threadId: string,
  settings: AppSettings,
  extraUserContent?: string,
): AssembledContext {
  const ctxSettings = contextSettingsFromApp(settings);
  const { messages: assembled, upstreamCount } = assembleThreadParts(
    threadId,
    extraUserContent,
  );
  const fullTokens = estimateMessagesTokens(assembled);
  const thread = getThread(threadId);
  const includedCount = thread
    ? listIncludedChildThreads(thread, listThreadsForSession(thread.session_id)).length
    : 0;
  // Flag for UI / compress prompt: only when bypass includes push past the hard window.
  const overBudget = includedCount > 0 && fullTokens > settings.contextWindow;
  const snapshot = buildContextSnapshot(
    assembled.map((m, i) => ({
      id: m.id ?? `assembled-${i}`,
      session_id: '',
      thread_id: threadId,
      role: m.role,
      content: m.content,
      created_at: 0,
      model_profile_id: null,
      model_label: null,
    })),
    ctxSettings,
    { protectPrefixCount: upstreamCount },
  );

  return {
    messages: assembled,
    overBudget,
    fullTokens,
    window: settings.contextWindow,
    snapshot,
    upstreamCount,
  };
}

async function summarizeThreadBlock(options: {
  settings: AppSettings;
  thread: ThreadRow;
  messages: MessageRow[];
}): Promise<string> {
  const locale = localeOf(options.settings);
  const quote = options.thread.anchor_quote?.trim() || options.thread.title;
  const transcript = options.messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n');

  return chatCompletion({
    baseUrl: options.settings.baseUrl,
    apiKey: options.settings.apiKey,
    model: options.settings.model,
    messages: [
      {
        role: 'system',
        content: t(locale, 'assemble.summarySystem'),
      },
      {
        role: 'user',
        content: t(locale, 'assemble.summaryUser', {
          title: options.thread.title,
          quote,
          transcript: transcript || t(locale, 'assemble.emptyTranscript'),
        }),
      },
    ],
  });
}

/**
 * Bottom-up ephemeral compress: summarize each included child, then assemble
 * target thread with summary blocks instead of full child transcripts.
 */
export async function assembleWithCompress(
  threadId: string,
  settings: AppSettings,
  extraUserContent?: string,
): Promise<AssembledParts> {
  const locale = localeOf(settings);
  const thread = getThread(threadId);
  if (!thread) throw new Error(t(locale, 'thread.notFound'));

  const all = listThreadsForSession(thread.session_id);
  const included = listIncludedChildThreads(thread, all);
  const seen = new Set<string>();
  const uniqueChildren: ThreadRow[] = [];
  for (const child of included) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    uniqueChildren.push(child);
  }

  // Deepest first
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = all.find((t) => t.id === id);
    while (cur?.parent_thread_id) {
      d += 1;
      cur = all.find((t) => t.id === cur!.parent_thread_id);
    }
    return d;
  };
  uniqueChildren.sort((a, b) => depthOf(b.id) - depthOf(a.id));

  const summaries = new Map<string, string>();
  for (const child of uniqueChildren) {
    const summary = await summarizeThreadBlock({
      settings,
      thread: child,
      messages: getThreadMessages(child.id),
    });
    summaries.set(child.id, summary);
  }

  const { upstream, own } = ownPaneWithOptionalUpstream(thread, locale, extraUserContent);
  const assembled = [...upstream, ...own];

  for (const child of uniqueChildren) {
    const quote = child.anchor_quote?.trim() || child.title;
    const summary = summaries.get(child.id) ?? '';
    assembled.push({
      role: 'system',
      content: t(locale, 'assemble.bypassSummary', {
        title: child.title,
        quote,
        summary,
      }),
    });
  }

  return { messages: assembled, upstreamCount: upstream.length };
}

export async function prepareChatMessages(options: {
  threadId: string;
  settings: AppSettings;
  /** Pending user content not yet persisted — used for overflow check / first insert path. */
  pendingUserContent?: string;
  allowCompress?: boolean;
}): Promise<
  | { ok: true; selected: ChatRoleMessage[]; assembled: ChatRoleMessage[]; snapshot: ContextSnapshot }
  | { ok: false; code: 'context_overflow'; assembled: ChatRoleMessage[]; snapshot: ContextSnapshot }
> {
  const ctxSettings = contextSettingsFromApp(options.settings);
  const preview = buildThreadContextSnapshot(
    options.threadId,
    options.settings,
    options.pendingUserContent,
  );

  // Overflow/compress only when bypass includes blow the hard window.
  // Own-thread history still uses v1.1 sliding window (compress summarizes children only).
  if (preview.overBudget && !options.allowCompress) {
    return {
      ok: false,
      code: 'context_overflow',
      assembled: preview.messages,
      snapshot: preview.snapshot,
    };
  }

  let assembled = preview.messages;
  let upstreamCount = preview.upstreamCount;
  if (preview.overBudget && options.allowCompress) {
    const compressed = await assembleWithCompress(
      options.threadId,
      options.settings,
      options.pendingUserContent,
    );
    assembled = compressed.messages;
    upstreamCount = compressed.upstreamCount;
  }

  const windowOpts = { protectPrefixCount: upstreamCount };
  const { selected } = buildSlidingWindow(assembled, ctxSettings, windowOpts);
  const snapshot = buildContextSnapshot(
    assembled.map((m, i) => ({
      id: m.id ?? `assembled-${i}`,
      session_id: '',
      thread_id: options.threadId,
      role: m.role,
      content: m.content,
      created_at: 0,
      model_profile_id: null,
      model_label: null,
    })),
    ctxSettings,
    windowOpts,
  );

  return { ok: true, selected, assembled, snapshot };
}
