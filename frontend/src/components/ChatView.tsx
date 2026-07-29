import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContextSnapshot, Message, ModelProfilePublic, SessionDetail, Thread } from '../api/client';
import {
  ApiError,
  buildDisplayPath,
  createThread,
  deleteThread,
  exportSession,
  fetchSession,
  fetchSessionContext,
  findThread,
  patchSession,
  patchThread,
  streamChat,
} from '../api/client';
import { useI18n } from '../i18n/LocaleContext';
import { ExportDialog } from './ExportDialog';
import { MessageMarkdown } from './MessageMarkdown';

type ChatViewProps = {
  sessionId: string | null;
  settingsEpoch?: number;
  exportAskEachTime: boolean;
  exportDir: string;
  profiles: ModelProfilePublic[];
  defaultProfileId: string | null;
  onSessionUpdated: () => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

type SelectionPopup = {
  x: number;
  y: number;
  quote: string;
  messageId: string;
  threadId: string;
};

function formatTokens(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return String(value);
}

type LocateFlash = {
  childId: string;
  messageId: string;
  nonce: number;
};

type AnchorHit = {
  child: Thread;
  start: number;
  end: number;
};

function collectAnchorHits(
  content: string,
  children: Thread[],
  messageId: string,
): { hits: AnchorHit[]; orphans: Thread[] } {
  const relevant = children.filter(
    (child) => child.anchor_message_id === messageId && Boolean(child.anchor_quote?.trim()),
  );
  const usedRanges: Array<[number, number]> = [];
  const hits: AnchorHit[] = [];
  const orphans: Thread[] = [];

  for (const child of relevant) {
    const quote = child.anchor_quote!.trim();
    let searchFrom = 0;
    let placed = false;
    while (searchFrom <= content.length) {
      const idx = content.indexOf(quote, searchFrom);
      if (idx < 0) break;
      const end = idx + quote.length;
      const overlaps = usedRanges.some(([start, stop]) => idx < stop && end > start);
      if (!overlaps) {
        usedRanges.push([idx, end]);
        hits.push({ child, start: idx, end });
        placed = true;
        break;
      }
      searchFrom = idx + 1;
    }
    if (!placed) orphans.push(child);
  }

  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  return { hits, orphans };
}

function LocateIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function BypassGuideChip({
  child,
  isUser,
  flashing,
  anchorKey,
  onOpen,
}: {
  child: Thread;
  isUser: boolean;
  flashing: boolean;
  /** Set for orphan chips (quote not found in body) so locate can still scroll here. */
  anchorKey?: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-anchor-key={anchorKey ? child.id : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold transition-colors ${
        isUser
          ? 'bg-white/20 text-teal-50 hover:bg-white/30'
          : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
      } ${flashing ? 'animate-anchor-flash' : ''}`}
      title={
        child.include_upstream === 1
          ? t('chat.expandBypassUpstream', { title: child.title })
          : t('chat.expandBypass', { title: child.title })
      }
    >
      <span className="shrink-0 opacity-80">↳</span>
      <span className="truncate">{t('chat.bypassLabel', { title: child.title })}</span>
      {child.include_upstream === 1 ? (
        <span
          className={`shrink-0 rounded px-1 py-px text-[9px] font-bold leading-none ${
            isUser ? 'bg-white/25 text-teal-50' : 'bg-sky-100 text-sky-800'
          }`}
        >
          {t('chat.withUpstream')}
        </span>
      ) : null}
    </button>
  );
}

function MessageBodyWithAnchors({
  content,
  messageId,
  isUser,
  childrenForMessage,
  locateFlash,
  streamingPlaceholder,
  onOpenBypass,
}: {
  content: string;
  messageId: string;
  isUser: boolean;
  childrenForMessage: Thread[];
  locateFlash: LocateFlash | null;
  streamingPlaceholder: boolean;
  onOpenBypass: (childId: string) => void;
}) {
  if (!content && streamingPlaceholder) {
    return (
      <span className="inline-flex items-center gap-1 text-stone-400 font-medium animate-pulse-subtle">
        <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    );
  }

  const markClass = isUser
    ? 'rounded-sm bg-white/25 text-white ring-1 ring-white/35'
    : 'rounded-sm bg-amber-100 text-amber-900 ring-1 ring-amber-200/80';

  if (childrenForMessage.length === 0) {
    return isUser ? <>{content}</> : <MessageMarkdown content={content} />;
  }

  const { hits, orphans } = collectAnchorHits(content, childrenForMessage, messageId);

  if (hits.length === 0 && orphans.length === 0) {
    return isUser ? <>{content}</> : <MessageMarkdown content={content} />;
  }

  // Split on raw source offsets so guide chips sit under the selection even when
  // Markdown would otherwise fragment the quote across nodes.
  const nodes: ReactNode[] = [];
  let cursor = 0;

  hits.forEach((hit, index) => {
    if (hit.start > cursor) {
      const slice = content.slice(cursor, hit.start);
      nodes.push(
        isUser ? (
          <span key={`t-${index}-${cursor}`}>{slice}</span>
        ) : (
          <MessageMarkdown key={`t-${index}-${cursor}`} content={slice} compact />
        ),
      );
    }
    const flashing = locateFlash?.childId === hit.child.id;
    nodes.push(
      <span
        key={`a-${hit.child.id}`}
        className="inline-flex max-w-full flex-col items-start align-top"
      >
        <mark
          data-anchor-key={hit.child.id}
          className={`${markClass} px-0.5 ${flashing ? 'animate-anchor-flash' : ''}`}
        >
          {content.slice(hit.start, hit.end)}
        </mark>
        <BypassGuideChip
          child={hit.child}
          isUser={isUser}
          flashing={false}
          onOpen={() => onOpenBypass(hit.child.id)}
        />
      </span>,
    );
    cursor = hit.end;
  });

  if (cursor < content.length) {
    const slice = content.slice(cursor);
    nodes.push(
      isUser ? (
        <span key={`t-tail-${cursor}`}>{slice}</span>
      ) : (
        <MessageMarkdown key={`t-tail-${cursor}`} content={slice} compact />
      ),
    );
  }

  return (
    <>
      {nodes}
      {orphans.length > 0 ? (
        <span className="mt-1 flex flex-col items-start gap-1">
          {orphans.map((child) => (
            <BypassGuideChip
              key={child.id}
              child={child}
              isUser={isUser}
              flashing={locateFlash?.childId === child.id}
              anchorKey
              onOpen={() => onOpenBypass(child.id)}
            />
          ))}
        </span>
      ) : null}
    </>
  );
}

function ThreadPane({
  thread,
  siblings,
  focused,
  depth,
  totalPanes,
  isExiting = false,
  context,
  streaming,
  streamingThreadId,
  locateFlash,
  onSelectSibling,
  onFocusThread,
  onLocateAnchor,
  onOpenBypass,
  onToggleIncludeInParent,
  onToggleIncludeAll,
  onDelete,
  onMessageSelect,
  input,
  onInputChange,
  onSend,
  modelSelectValue,
  modelOptions,
  modelSelectDisabled,
  onModelChange,
}: {
  thread: Thread;
  siblings: Thread[];
  focused: boolean;
  depth: number;
  totalPanes: number;
  isExiting?: boolean;
  context: ContextSnapshot | null;
  streaming: boolean;
  streamingThreadId: string | null;
  locateFlash: LocateFlash | null;
  onSelectSibling: (id: string) => void;
  onFocusThread: () => void;
  onLocateAnchor: (child: Thread) => void;
  onOpenBypass: (childId: string) => void;
  onToggleIncludeInParent: (value: boolean) => void;
  onToggleIncludeAll: (value: boolean) => void;
  onDelete: (() => void) | null;
  onMessageSelect: (payload: {
    quote: string;
    messageId: string;
    threadId: string;
    x: number;
    y: number;
  }) => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  modelSelectValue: string;
  modelOptions: Array<{ id: string; label: string }>;
  modelSelectDisabled: boolean;
  onModelChange: (profileId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isStreamingHere = streaming && streamingThreadId === thread.id;
  const { t } = useI18n();
  const included = new Set(context?.includedMessageIds ?? []);
  const showTrimHint = Boolean(focused && context?.trimmed && context.autoTrim);
  const overWindow = Boolean(
    focused && context && !context.autoTrim && context.sentTokens > context.window,
  );
  const overBudget = Boolean(focused && context?.overBudget);

  const [entering, setEntering] = useState(() => depth > 0 && !isExiting);

  useEffect(() => {
    if (!entering) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      // Double rAF: ensure the collapsed first paint is committed before expanding.
      raf2 = requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [entering]);

  useEffect(() => {
    if (focused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages, isStreamingHere, focused]);

  const isCollapsed = isExiting || entering;

  const paneStyle: CSSProperties = isCollapsed
    ? {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: '0px',
        minWidth: 0,
        maxWidth: '0%',
        opacity: 0,
        transform: 'translateX(24px)',
        pointerEvents: 'none',
        paddingLeft: 0,
        paddingRight: 0,
        borderLeftWidth: 0,
        borderRightWidth: 0,
        margin: 0,
        overflow: 'hidden',
      }
    : {
        // Prefer px flex-basis so collapse ↔ expand can interpolate (px↔% cannot).
        flexGrow: totalPanes > 1 ? (focused ? 2.6 : 1) : 1,
        flexShrink: 1,
        flexBasis: totalPanes > 1 ? (focused ? '320px' : '200px') : '320px',
        minWidth: totalPanes > 1 ? (focused ? 320 : 180) : 0,
        maxWidth: '100%',
        opacity: 1,
        transform: 'translateX(0)',
        overflow: 'hidden',
      };

  function focusThisPane(event: { target: EventTarget | null }): void {
    if (focused || isCollapsed) return;
    const target = event.target as HTMLElement | null;
    // Let native controls / anchor-jump handle themselves — do not focus the pane.
    if (target?.closest('button, input, textarea, label, a, [data-anchor-jump="true"]')) return;
    onFocusThread();
  }

  return (
    <section
      style={paneStyle}
      onMouseDown={focusThisPane}
      title={focused || isCollapsed ? undefined : t('chat.focusPane')}
      className={`pane-transition relative flex h-full min-w-0 flex-col border-r border-stone-200 overflow-hidden ${
        focused && !isCollapsed
          ? 'bg-white shadow-soft z-10 opacity-100'
          : 'cursor-pointer bg-stone-100/60 opacity-85 hover:opacity-100 hover:bg-stone-100'
      }`}
    >
      {/* Sibling Tabs */}
      {siblings.length > 1 ? (
        <div className="flex max-h-36 shrink-0 flex-col gap-1 overflow-y-auto border-b border-stone-200 bg-stone-100/70 p-2 transition-colors">
          <div className="px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">
            {t('chat.siblingBypasses', { count: siblings.length })}
          </div>
          {siblings.map((sib) => {
            const activeSib = sib.id === thread.id;
            const canLocate = Boolean(sib.anchor_message_id);
            return (
              <div
                key={sib.id}
                className={`group flex items-center gap-0.5 rounded-lg transition-all duration-200 ${
                  activeSib
                    ? 'bg-teal-600 text-white'
                    : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-900'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSibling(sib.id)}
                  className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs font-medium"
                  title={
                    sib.include_upstream === 1
                      ? `${sib.anchor_quote ?? sib.title} (${t('chat.withUpstream')})`
                      : (sib.anchor_quote ?? sib.title)
                  }
                >
                  {sib.include_upstream === 1 ? (
                    <span
                      className={`mr-1 inline-block rounded px-1 py-px text-[9px] font-bold leading-none tracking-wide ${
                        activeSib ? 'bg-white/20 text-white' : 'bg-sky-100 text-sky-700'
                      }`}
                    >
                      {t('chat.upstreamShort')}
                    </span>
                  ) : null}
                  {sib.title}
                </button>
                {canLocate ? (
                  <button
                    type="button"
                    data-anchor-jump="true"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onLocateAnchor(sib);
                    }}
                    className={`mr-1 shrink-0 rounded-md p-1 transition-colors ${
                      activeSib
                        ? 'text-white/80 hover:bg-white/15 hover:text-white'
                        : 'text-stone-400 hover:bg-stone-300/60 hover:text-teal-700'
                    }`}
                    title={t('chat.locateSource')}
                  >
                    <LocateIcon />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Pane Header (key by thread.id for content-switch animation) */}
      <header
        key={`header-${thread.id}`}
        className={`flex shrink-0 flex-col gap-2 border-b border-stone-200 px-4 py-3 transition-all duration-200 animate-content-switch ${
          focused ? 'bg-white' : 'bg-transparent'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full transition-all duration-300 ${
                  focused ? 'bg-teal-500 ring-4 ring-teal-100 scale-110' : 'bg-stone-300'
                }`}
              />
              <h3 className="truncate text-sm font-semibold text-stone-800 tracking-tight">{thread.title}</h3>
              {thread.include_upstream === 1 ? (
                <span
                  className="shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200/80"
                  title={t('chat.anchorUpstreamTitle')}
                >
                  {t('chat.withUpstream')}
                </span>
              ) : null}
            </div>
            {thread.anchor_quote && thread.anchor_message_id ? (
              <button
                type="button"
                data-anchor-jump="true"
                onMouseDown={(event) => {
                  // Prevent pane mousedown focus; locate must not select this bypass.
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onLocateAnchor(thread);
                }}
                className="mt-1.5 flex w-full items-start gap-1.5 rounded-lg border border-teal-100 bg-teal-50/60 px-2.5 py-1.5 text-left text-[11px] text-teal-900 transition-colors hover:border-teal-200 hover:bg-teal-50"
                title={t('chat.locateSource')}
              >
                <LocateIcon className="mt-0.5 h-3 w-3 shrink-0 text-teal-600" />
                <span className="line-clamp-2 min-w-0 flex-1 italic">{t('chat.selection', { quote: thread.anchor_quote })}</span>
              </button>
            ) : thread.anchor_quote ? (
              <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-teal-100 bg-teal-50/60 px-2.5 py-1.5 text-[11px] text-teal-900">
                <svg className="mt-0.5 h-3 w-3 shrink-0 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <span className="line-clamp-2 min-w-0 flex-1 italic">{t('chat.selection', { quote: thread.anchor_quote })}</span>
              </div>
            ) : null}
          </div>
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="shrink-0 rounded-lg p-1 text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
              title={t('chat.deleteBypass')}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          ) : null}
        </div>

        {/* Checkboxes & Context Pills */}
        <div
          className="flex flex-wrap items-center gap-3 text-xs text-stone-600"
          onClick={(e) => e.stopPropagation()}
        >
          {thread.parent_thread_id ? (
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium hover:text-teal-700 transition-colors">
              <input
                type="checkbox"
                checked={thread.include_in_parent === 1}
                onChange={(e) => onToggleIncludeInParent(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
              />
              {t('chat.includeInParent')}
            </label>
          ) : null}
          {thread.children.length > 0 || thread.parent_thread_id === null ? (
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium hover:text-teal-700 transition-colors">
              <input
                type="checkbox"
                checked={thread.include_all_descendants === 1}
                onChange={(e) => onToggleIncludeAll(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
              />
              {t('chat.includeAllDescendants')}
            </label>
          ) : null}
        </div>

        {focused && context ? (
          <div className="flex items-center gap-2 text-[11px] text-stone-500 font-mono animate-fade-in">
            <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
              {t('chat.sentTokens', {
                sent: formatTokens(context.sentTokens),
                window: formatTokens(context.window),
                ratio: (context.ratio * 100).toFixed(1),
              })}
            </span>
            {showTrimHint ? <span className="text-amber-600 font-sans">{t('chat.trimHint')}</span> : null}
            {overWindow ? <span className="text-rose-600 font-sans">{t('chat.overWindow')}</span> : null}
            {overBudget ? <span className="text-amber-600 font-sans font-medium">{t('chat.overBudget')}</span> : null}
            {context.fullTokens !== context.sentTokens ? (
              <span className="text-stone-400 font-sans">{t('chat.fullTokens', { tokens: formatTokens(context.fullTokens) })}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Messages (key by thread.id so switching siblings triggers content-switch animation) */}
      <div key={`msglist-${thread.id}`} className="flex-1 overflow-y-auto px-4 py-4 animate-content-switch">
        <div className="flex flex-col gap-4">
          {showTrimHint ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 animate-fade-in">
              {t('chat.trimExplain')}
            </div>
          ) : null}
          {overWindow ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 animate-fade-in">
              {t('chat.overWindowExplain')}
            </div>
          ) : null}
          {overBudget ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 animate-fade-in">
              {t('chat.overBudgetExplain')}
            </div>
          ) : null}

          {thread.messages.map((message) => {
            const inWindow =
              !focused ||
              !context?.autoTrim ||
              !context.trimmed ||
              included.size === 0 ||
              included.has(message.id) ||
              message.id.startsWith('temp-');
            const isUser = message.role === 'user';
            const childrenForMessage = thread.children.filter(
              (child) => child.anchor_message_id === message.id,
            );
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                data-thread-id={thread.id}
                className={`selectable-msg group relative flex flex-col transition-all duration-200 ${
                  isUser ? 'items-end' : 'items-start'
                } ${inWindow ? 'opacity-100' : 'opacity-40 filter grayscale-[20%]'}`}
                onContextMenu={(event) => {
                  if (message.id.startsWith('temp-')) return;
                  const sel = window.getSelection();
                  const quote = sel?.toString().trim() ?? '';
                  if (!quote) return;
                  const anchorNode = sel?.anchorNode;
                  const focusNode = sel?.focusNode;
                  if (
                    !anchorNode ||
                    !event.currentTarget.contains(anchorNode) ||
                    (focusNode && !event.currentTarget.contains(focusNode))
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onMessageSelect({
                    quote,
                    messageId: message.id,
                    threadId: thread.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                {/* Role Header */}
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-stone-400">
                  <span>{isUser ? t('chat.you') : t('chat.assistant')}</span>
                  {!inWindow ? (
                    <span className="rounded bg-stone-200/80 px-1 py-0.2 text-[10px] text-stone-500 font-normal">
                      {t('chat.notInUpstream')}
                    </span>
                  ) : null}
                </div>

                {/* Message Bubble */}
                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed animate-fade-in ${
                    isUser
                      ? 'whitespace-pre-wrap bg-teal-600 text-white rounded-tr-md'
                      : 'bg-white border border-stone-200 text-stone-800 rounded-tl-md'
                  }`}
                >
                  <MessageBodyWithAnchors
                    content={message.content}
                    messageId={message.id}
                    isUser={isUser}
                    childrenForMessage={childrenForMessage}
                    locateFlash={locateFlash}
                    streamingPlaceholder={isStreamingHere && !message.content}
                    onOpenBypass={onOpenBypass}
                  />
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="shrink-0 border-t border-stone-200 bg-white p-3"
        onFocusCapture={onFocusThread}
      >
        <div className="flex gap-2 items-end">
          <div className="relative flex-1 rounded-xl border border-stone-200 bg-stone-50 p-2 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/15 transition-all duration-200">
            <textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              rows={2}
              placeholder={t('chat.placeholder')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              className="w-full resize-none bg-transparent px-1 text-sm text-stone-800 outline-none placeholder:text-stone-400"
            />
            <div className="mt-1.5 flex items-center gap-2 border-t border-stone-200/80 pt-1.5">
              <select
                value={modelSelectValue}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={modelSelectDisabled}
                className="max-w-[min(100%,14rem)] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-medium text-stone-600 outline-none hover:border-stone-200 hover:bg-white focus:border-teal-500 focus:bg-white focus:ring-1 focus:ring-teal-500/20 disabled:opacity-40"
                title={t('chat.sessionModel')}
                aria-label={t('chat.sessionModel')}
              >
                {modelOptions.map((option) => (
                  <option key={option.id || 'follow-default'} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 active:bg-teal-800 shrink-0"
          >
            {isStreamingHere ? (
              <span className="inline-flex items-center gap-1">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </span>
            ) : (
              <>
                <span>{t('chat.send')}</span>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ChatView({
  sessionId,
  settingsEpoch = 0,
  exportAskEachTime,
  exportDir,
  profiles,
  defaultProfileId,
  onSessionUpdated,
  onError,
  onInfo,
}: ChatViewProps) {
  const { t } = useI18n();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [inputsByThread, setInputsByThread] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingThreadId, setStreamingThreadId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);
  const [includeUpstream, setIncludeUpstream] = useState(false);
  /** Remember last child under each parent so switching A→D→B restores B→C. */
  const [preferredChildByParent, setPreferredChildByParent] = useState<
    Record<string, string>
  >({});
  const [overflowPrompt, setOverflowPrompt] = useState<{
    content: string;
    threadId: string;
  } | null>(null);
  const [locateFlash, setLocateFlash] = useState<LocateFlash | null>(null);

  type ExitingPane = {
    thread: Thread;
    depth: number;
    siblings: Thread[];
  };

  /** Must be available in the same render as path shrink — setState would drop one frame. */
  const prevDisplayPathRef = useRef<Thread[]>([]);
  const exitingPanesRef = useRef<ExitingPane[]>([]);
  const [exitEpoch, setExitEpoch] = useState(0);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshContext = useCallback(
    async (id: string, threadId: string) => {
      try {
        const snapshot = await fetchSessionContext(id, threadId);
        setContext(snapshot);
      } catch {
        // non-fatal
      }
    },
    [],
  );

  const reloadSession = useCallback(
    async (id: string, preferThreadId?: string | null) => {
      const detail = await fetchSession(id);
      setSession(detail);
      const nextThread =
        (preferThreadId && findThread(detail.threadTree, preferThreadId)?.id) ||
        (activeThreadId && findThread(detail.threadTree, activeThreadId)?.id) ||
        detail.rootThreadId;
      setActiveThreadId(nextThread);
      await refreshContext(id, nextThread);
      return detail;
    },
    [activeThreadId, refreshContext],
  );

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setContext(null);
      setActiveThreadId(null);
      setInputsByThread({});
      setPreferredChildByParent({});
      return;
    }

    setLoading(true);
    reloadSession(sessionId)
      .catch((err) => onError(err instanceof Error ? err.message : t('chat.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload on session change
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !activeThreadId || settingsEpoch === 0) return;
    void refreshContext(sessionId, activeThreadId);
  }, [settingsEpoch, sessionId, activeThreadId, refreshContext]);

  useEffect(() => {
    if (!sessionId || !activeThreadId) return;
    void refreshContext(sessionId, activeThreadId);
  }, [sessionId, activeThreadId, refreshContext]);

  const displayPath = useMemo(() => {
    if (!session || !activeThreadId) return [] as Thread[];
    return buildDisplayPath(session.threadTree, activeThreadId, preferredChildByParent);
  }, [session, activeThreadId, preferredChildByParent]);

  // Keep dropped depth columns in THIS render so CSS can animate width → 0.
  // Keys stay `pane-depth-${depth}` so React reuses the same DOM nodes.
  if (prevDisplayPathRef.current !== displayPath) {
    const prevPath = prevDisplayPathRef.current;
    if (prevPath.length > displayPath.length && displayPath.length > 0) {
      const dropped = prevPath.slice(displayPath.length);
      exitingPanesRef.current = dropped.map((thread, idx) => {
        const depth = displayPath.length + idx;
        const parent = depth === 0 ? null : prevPath[depth - 1];
        return {
          thread,
          siblings: parent ? parent.children : [thread],
          depth,
        };
      });
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        exitingPanesRef.current = [];
        setExitEpoch((n) => n + 1);
      }, 350);
    } else if (displayPath.length >= prevPath.length && exitingPanesRef.current.length > 0) {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitingPanesRef.current = [];
    }
    prevDisplayPathRef.current = displayPath;
  }

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    exitingPanesRef.current = [];
    prevDisplayPathRef.current = [];
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
  }, [sessionId]);

  useEffect(() => {
    if (displayPath.length < 2) return;
    setPreferredChildByParent((prev) => {
      let changed = false;
      const next = { ...prev };
      for (let i = 0; i < displayPath.length - 1; i += 1) {
        const parentId = displayPath[i].id;
        const childId = displayPath[i + 1].id;
        if (next[parentId] !== childId) {
          next[parentId] = childId;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [displayPath]);

  useEffect(() => {
    if (!selectionPopup) return;
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-bypass-menu="true"]')) return;
      setSelectionPopup(null);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setSelectionPopup(null);
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectionPopup]);

  function selectSiblingAtDepth(_depth: number, siblingId: string): void {
    if (!session) return;
    if (!findThread(session.threadTree, siblingId)) return;
    setActiveThreadId(siblingId);
  }

  function focusThread(threadId: string): void {
    if (!session) return;
    if (!findThread(session.threadTree, threadId)) return;
    setActiveThreadId(threadId);
  }

  /** Reveal bypass column under its parent without focusing/selecting that bypass. */
  function revealBypass(childId: string): void {
    if (!session) return;
    const child = findThread(session.threadTree, childId);
    if (!child?.parent_thread_id) return;
    const parentId = child.parent_thread_id;
    setPreferredChildByParent((prev) =>
      prev[parentId] === childId ? prev : { ...prev, [parentId]: childId },
    );
    // Stay on the parent (source text pane), not the bypass.
    if (activeThreadId !== parentId) {
      setActiveThreadId(parentId);
    }
  }

  function locateAnchor(child: Thread): void {
    if (!child.anchor_message_id || !child.parent_thread_id) return;
    const parentId = child.parent_thread_id;
    // R7: focus the source-text parent pane; do not select the bypass as active.
    // Do not touch preferredChildByParent — that would switch which sibling column is shown.
    if (activeThreadId !== parentId) {
      setActiveThreadId(parentId);
    }
    setLocateFlash({
      childId: child.id,
      messageId: child.anchor_message_id,
      nonce: Date.now(),
    });
  }

  useEffect(() => {
    if (!locateFlash) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector(`[data-anchor-key="${locateFlash.childId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 40);
    const clear = window.setTimeout(() => setLocateFlash(null), 1600);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [locateFlash]);

  function setThreadInput(threadId: string, value: string): void {
    setInputsByThread((prev) => ({ ...prev, [threadId]: value }));
  }

  async function handleSend(options?: { allowCompress?: boolean; content?: string; threadId?: string }) {
    if (!sessionId || streaming) return;
    const threadId = options?.threadId ?? activeThreadId;
    const content = (options?.content ?? (threadId ? inputsByThread[threadId] : '') ?? '').trim();
    if (!threadId || !content) return;

    if (!options?.content) setThreadInput(threadId, '');
    setActiveThreadId(threadId);
    setStreaming(true);
    setStreamingThreadId(threadId);
    setOverflowPrompt(null);

    const optimisticUser: Message = {
      id: `temp-user-${Date.now()}`,
      session_id: sessionId,
      thread_id: threadId,
      role: 'user',
      content,
      created_at: Date.now(),
    };
    const optimisticAssistant: Message = {
      id: `temp-assistant-${Date.now()}`,
      session_id: sessionId,
      thread_id: threadId,
      role: 'assistant',
      content: '',
      created_at: Date.now(),
    };

    setSession((prev) => {
      if (!prev) return prev;
      const patchMessages = (node: Thread): Thread => {
        if (node.id === threadId) {
          return {
            ...node,
            messages: [...node.messages, optimisticUser, optimisticAssistant],
          };
        }
        return { ...node, children: node.children.map(patchMessages) };
      };
      return {
        ...prev,
        threadTree: patchMessages(prev.threadTree),
        messages:
          threadId === prev.rootThreadId
            ? [...prev.messages, optimisticUser, optimisticAssistant]
            : prev.messages,
      };
    });

    try {
      const result = await streamChat(
        sessionId,
        content,
        (delta) => {
          setSession((prev) => {
            if (!prev) return prev;
            const patchMessages = (node: Thread): Thread => {
              if (node.id !== threadId) {
                return { ...node, children: node.children.map(patchMessages) };
              }
              const messages = [...node.messages];
              const lastIndex = messages.length - 1;
              const last = messages[lastIndex];
              if (!last || last.role !== 'assistant') return node;
              messages[lastIndex] = { ...last, content: last.content + delta };
              return { ...node, messages };
            };
            return { ...prev, threadTree: patchMessages(prev.threadTree) };
          });
        },
        { threadId, allowCompress: options?.allowCompress },
      );

      if (result.context) setContext(result.context);
      await reloadSession(sessionId, threadId);
      onSessionUpdated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'context_overflow') {
        // Roll back optimistic messages — user message was not persisted
        await reloadSession(sessionId, threadId).catch(() => null);
        setOverflowPrompt({ content, threadId });
        if (err.context) setContext(err.context);
      } else {
        onError(err instanceof Error ? err.message : t('chat.sendFailed'));
        await reloadSession(sessionId, threadId).catch(() => null);
      }
    } finally {
      setStreaming(false);
      setStreamingThreadId(null);
    }
  }

  async function handleCreateBypass(): Promise<void> {
    if (!sessionId || !selectionPopup) return;
    try {
      const thread = await createThread(sessionId, {
        parentThreadId: selectionPopup.threadId,
        anchorMessageId: selectionPopup.messageId,
        anchorQuote: selectionPopup.quote,
        includeUpstream,
      });
      setSelectionPopup(null);
      setIncludeUpstream(false);
      await reloadSession(sessionId, thread.id);
      onInfo(t('chat.bypassOpened', { title: thread.title }));
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.bypassFailed'));
    }
  }

  async function handlePatchFlags(
    threadId: string,
    patch: { includeInParent?: boolean; includeAllDescendants?: boolean },
  ): Promise<void> {
    try {
      await patchThread(threadId, patch);
      if (sessionId) await reloadSession(sessionId, activeThreadId);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.includeUpdateFailed'));
    }
  }

  async function handleDeleteThread(threadId: string): Promise<void> {
    if (!window.confirm(t('chat.deleteBypassConfirm'))) return;
    try {
      await deleteThread(threadId);
      if (sessionId) {
        const detail = await reloadSession(sessionId, null);
        setActiveThreadId(detail.rootThreadId);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.deleteFailed'));
    }
  }

  async function handleModelChange(value: string): Promise<void> {
    if (!sessionId || !session) return;
    // Empty string = follow global default (NULL override).
    const nextId = value === '' ? null : value;
    if ((session.model_profile_id ?? null) === nextId) return;
    try {
      const updated = await patchSession(sessionId, { model_profile_id: nextId });
      setSession((prev) =>
        prev
          ? { ...prev, model_profile_id: updated.model_profile_id ?? null }
          : prev,
      );
      onSessionUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.switchModelFailed'));
    }
  }

  async function performExport(customPath?: string): Promise<void> {
    if (!sessionId) return;
    try {
      const result = await exportSession(sessionId, customPath);
      onInfo(t('chat.exported', { path: result.path }));
      setExportOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('chat.exportFailed'));
    }
  }

  if (!sessionId) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white text-stone-400 font-medium">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p>{t('chat.empty')}</p>
        </div>
      </main>
    );
  }

  if (loading && !session) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white text-stone-400 font-medium">
        <div className="flex items-center gap-2 animate-fade-in">
          <svg className="h-5 w-5 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>{t('chat.loading')}</span>
        </div>
      </main>
    );
  }

  const activePanes = displayPath.map((thread, depth) => {
    const parent = depth === 0 ? null : displayPath[depth - 1];
    const siblings =
      depth === 0
        ? session
          ? [session.threadTree]
          : [thread]
        : parent?.children ?? [thread];
    const focused = thread.id === activeThreadId;
    return {
      id: `pane-depth-${depth}`,
      thread,
      siblings,
      depth,
      focused,
      isExiting: false,
    };
  });

  const exitingPanesToRender = exitingPanesRef.current.map((p) => ({
    // Same depth key as the live column so React updates isExiting in place.
    id: `pane-depth-${p.depth}`,
    thread: p.thread,
    siblings: p.siblings,
    depth: p.depth,
    focused: false,
    isExiting: true,
  }));

  // exitEpoch invalidates after timer clears the ref.
  const renderedPanes = [...activePanes, ...exitingPanesToRender];
  void exitEpoch;
  const suggestedExportPath = `${exportDir.replace(/\/$/, '')}/${session?.title ?? 'chat'}`;

  const defaultProfile =
    profiles.find((p) => p.id === defaultProfileId) ?? profiles[0] ?? null;
  const selectValue =
    session?.model_profile_id &&
    profiles.some((profile) => profile.id === session.model_profile_id)
      ? session.model_profile_id
      : '';
  const nameCounts = profiles.reduce<Record<string, number>>((acc, profile) => {
    const key = profile.name.trim() || t('chat.unnamed');
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const modelOptions = [
    {
      id: '',
      label: defaultProfile
        ? t('chat.followDefaultNamed', { name: defaultProfile.name })
        : t('chat.followDefault'),
    },
    ...profiles.map((profile) => {
      const name = profile.name.trim() || t('chat.unnamed');
      const label =
        (nameCounts[name] ?? 0) > 1 ? `${name} · ${profile.model}` : name;
      return { id: profile.id, label };
    }),
  ];

  return (
    <main className="relative flex flex-1 flex-col bg-white">
      {/* Top Bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6 py-3 z-10">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-stone-900 tracking-tight">{session?.title ?? t('chat.conversation')}</h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {t('chat.headerHint')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (exportAskEachTime) setExportOpen(true);
              else void performExport();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors duration-150"
          >
            <svg className="h-3.5 w-3.5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {t('chat.exportDir')}
          </button>
        </div>
      </header>

      {/* Main Multi-Pane View */}
      <div className="flex min-h-0 flex-1 overflow-x-auto p-1">
        {renderedPanes.map((pane) => (
          <ThreadPane
            key={pane.id}
            thread={pane.thread}
            siblings={pane.siblings}
            focused={pane.focused}
            depth={pane.depth}
            totalPanes={renderedPanes.length}
            isExiting={pane.isExiting}
            context={pane.focused ? context : null}
            streaming={streaming}
            streamingThreadId={streamingThreadId}
            locateFlash={locateFlash}
            onSelectSibling={(id) => selectSiblingAtDepth(pane.depth, id)}
            onFocusThread={() => focusThread(pane.thread.id)}
            onLocateAnchor={locateAnchor}
            onOpenBypass={(childId) => revealBypass(childId)}
            onToggleIncludeInParent={(value) =>
              void handlePatchFlags(pane.thread.id, { includeInParent: value })
            }
            onToggleIncludeAll={(value) =>
              void handlePatchFlags(pane.thread.id, { includeAllDescendants: value })
            }
            onDelete={
              pane.thread.parent_thread_id
                ? () => void handleDeleteThread(pane.thread.id)
                : null
            }
            onMessageSelect={(payload) =>
              setSelectionPopup({
                x: payload.x,
                y: payload.y,
                quote: payload.quote,
                messageId: payload.messageId,
                threadId: payload.threadId,
              })
            }
            input={inputsByThread[pane.thread.id] ?? ''}
            onInputChange={(value) => setThreadInput(pane.thread.id, value)}
            onSend={() => void handleSend({ threadId: pane.thread.id })}
            modelSelectValue={selectValue}
            modelOptions={modelOptions}
            modelSelectDisabled={streaming || profiles.length === 0}
            onModelChange={(value) => void handleModelChange(value)}
          />
        ))}
      </div>

      {/* Right-click Selection Menu */}
      {selectionPopup ? (
        <div
          data-bypass-menu="true"
          className="fixed z-50 w-72 rounded-xl border border-stone-200 bg-white p-4 shadow-pop animate-pop-in text-stone-800"
          style={{
            left: Math.min(selectionPopup.x, window.innerWidth - 300),
            top: Math.min(selectionPopup.y + 8, window.innerHeight - 180),
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-bold text-stone-800">{t('chat.openBypass')}</span>
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">{t('chat.subChat')}</span>
          </div>
          <p className="mb-3 line-clamp-3 rounded-lg bg-stone-50 border border-stone-100 p-2 text-xs text-stone-600 italic">
            「{selectionPopup.quote}」
          </p>
          <label className="mb-4 flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includeUpstream}
              onChange={(e) => setIncludeUpstream(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
            />
            {t('chat.includeFullUpstream')}
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors"
              onClick={() => setSelectionPopup(null)}
            >
              {t('chat.cancel')}
            </button>
            <button
              type="button"
              className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition-colors active:bg-teal-800"
              onClick={() => void handleCreateBypass()}
            >
              {t('chat.startBypass')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Overflow Compression Prompt Modal */}
      {overflowPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-pop animate-pop-in">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="mb-1.5 text-base font-bold text-stone-900">{t('chat.overflowTitle')}</h2>
            <p className="mb-5 text-xs leading-relaxed text-stone-600">
              {t('chat.overflowBody')}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                className="rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 transition-colors"
                onClick={() => {
                  setOverflowPrompt(null);
                  setThreadInput(overflowPrompt.threadId, overflowPrompt.content);
                  setActiveThreadId(overflowPrompt.threadId);
                }}
              >
                {t('chat.reject')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 transition-colors active:bg-teal-800"
                onClick={() =>
                  void handleSend({
                    allowCompress: true,
                    content: overflowPrompt.content,
                    threadId: overflowPrompt.threadId,
                  })
                }
              >
                {t('chat.compressSend')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ExportDialog
        open={exportOpen}
        defaultPath={suggestedExportPath}
        onClose={() => setExportOpen(false)}
        onConfirm={(path) => void performExport(path)}
      />
    </main>
  );
}
