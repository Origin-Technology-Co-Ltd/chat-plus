import type { MessageRow } from '../db/init.js';

export type ChatRoleMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ContextSettings = {
  contextWindow: number;
  contextAutoTrim: boolean;
  contextKeepRounds: number;
  contextTargetRatio: number;
};

export type ContextSnapshot = {
  fullTokens: number;
  sentTokens: number;
  window: number;
  ratio: number;
  trimmed: boolean;
  keepRounds: number;
  autoTrim: boolean;
  /** message ids included in the send window; empty if no ids */
  includedMessageIds: string[];
};

/** Heuristic token estimate: CJK ~1.5 chars/token, Latin ~4 chars/token. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.max(1, Math.ceil(cjk / 1.5 + other / 4));
}

export function estimateMessagesTokens(messages: Array<{ content: string }>): number {
  // small per-message overhead for role framing
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
}

function countRounds(messages: ChatRoleMessage[]): number {
  return messages.filter((message) => message.role === 'user').length;
}

export type SlidingWindowOptions = {
  /**
   * Prefix length that must stay (e.g. bypass `include_upstream` parent messages).
   * keepRounds / token budget only trim the suffix after this prefix.
   */
  protectPrefixCount?: number;
};

/**
 * Keep the most recent N user rounds (each user message starts a round),
 * then optionally shrink further to fit target token budget.
 */
export function buildSlidingWindow(
  messages: ChatRoleMessage[],
  settings: ContextSettings,
  options?: SlidingWindowOptions,
): { selected: ChatRoleMessage[]; trimmed: boolean } {
  if (!settings.contextAutoTrim || messages.length === 0) {
    return { selected: messages, trimmed: false };
  }

  const protect = Math.max(
    0,
    Math.min(options?.protectPrefixCount ?? 0, messages.length),
  );
  const prefix = messages.slice(0, protect);
  const rest = messages.slice(protect);

  if (rest.length === 0) {
    return { selected: messages, trimmed: false };
  }

  const keepRounds = Math.max(1, settings.contextKeepRounds);
  const budget = Math.max(
    256,
    Math.floor(settings.contextWindow * Math.min(Math.max(settings.contextTargetRatio, 0.1), 1)),
  );

  let selectedRest = rest;
  const totalRounds = countRounds(rest);
  if (totalRounds > keepRounds) {
    let userSeen = 0;
    let startIndex = 0;
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      if (rest[i].role === 'user') {
        userSeen += 1;
        if (userSeen === keepRounds) {
          startIndex = i;
          break;
        }
      }
    }
    selectedRest = rest.slice(startIndex);
  }

  // Budget applies to the full send (prefix + rest). Prefer dropping from rest first.
  while (
    selectedRest.length > 0 &&
    estimateMessagesTokens([...prefix, ...selectedRest]) > budget
  ) {
    const dropCount =
      selectedRest[0]?.role === 'user' && selectedRest[1]?.role === 'assistant' ? 2 : 1;
    if (selectedRest.length <= dropCount) {
      selectedRest = [];
      break;
    }
    selectedRest = selectedRest.slice(dropCount);
  }

  const selected = [...prefix, ...selectedRest];
  const trimmed = selected.length < messages.length;
  return { selected, trimmed };
}

export function buildContextSnapshot(
  messages: Array<MessageRow | ChatRoleMessage>,
  settings: ContextSettings,
  options?: SlidingWindowOptions,
): ContextSnapshot {
  const normalized: ChatRoleMessage[] = messages.map((message) => ({
    id: 'id' in message ? message.id : undefined,
    role: message.role,
    content: message.content,
  }));

  const fullTokens = estimateMessagesTokens(normalized);
  const { selected, trimmed } = buildSlidingWindow(normalized, settings, options);
  const sentTokens = estimateMessagesTokens(selected);
  const window = settings.contextWindow;
  const ratio = window > 0 ? sentTokens / window : 0;

  return {
    fullTokens,
    sentTokens,
    window,
    ratio,
    trimmed,
    keepRounds: settings.contextKeepRounds,
    autoTrim: settings.contextAutoTrim,
    includedMessageIds: selected
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id)),
  };
}
