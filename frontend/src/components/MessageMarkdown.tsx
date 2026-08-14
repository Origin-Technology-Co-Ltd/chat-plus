import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type MarkdownAnchor = {
  id: string;
  quote: string;
  mark: ReactNode;
};

type MessageMarkdownProps = {
  content: string;
  /** Optional inline marks: first unused occurrence of each quote in rendered text. */
  anchors?: MarkdownAnchor[];
  /** When true, omit outer block wrapper so slices can sit inline with guide chips. */
  compact?: boolean;
};

function applyAnchorsToText(
  text: string,
  anchors: MarkdownAnchor[],
  used: Set<string>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let bestIdx = -1;
    let best: MarkdownAnchor | null = null;
    for (const anchor of anchors) {
      if (used.has(anchor.id)) continue;
      const idx = remaining.indexOf(anchor.quote);
      if (idx < 0) continue;
      if (bestIdx < 0 || idx < bestIdx) {
        bestIdx = idx;
        best = anchor;
      }
    }
    if (!best || bestIdx < 0) {
      nodes.push(remaining);
      break;
    }
    if (bestIdx > 0) {
      nodes.push(remaining.slice(0, bestIdx));
    }
    used.add(best.id);
    nodes.push(
      <span key={`md-a-${best.id}-${key++}`} className="inline-flex max-w-full flex-col items-start align-top">
        {best.mark}
      </span>,
    );
    remaining = remaining.slice(bestIdx + best.quote.length);
  }

  return nodes;
}

function applyAnchorsToTree(node: ReactNode, anchors: MarkdownAnchor[], used: Set<string>): ReactNode {
  if (anchors.length === 0 || used.size === anchors.length) return node;

  return Children.map(node, (child) => {
    if (child == null || typeof child === 'boolean') return child;
    if (typeof child === 'string') {
      return applyAnchorsToText(child, anchors, used);
    }
    if (typeof child === 'number') return child;
    if (!isValidElement(child)) return child;

    const el = child as ReactElement<{ children?: ReactNode }>;
    if (el.props.children == null) return el;
    return cloneElement(el, {
      ...el.props,
      children: applyAnchorsToTree(el.props.children, anchors, used),
    });
  });
}

export function MessageMarkdown({ content, anchors = [], compact = false }: MessageMarkdownProps) {
  // Shared across element remappers in one render so each quote is marked once.
  const used = new Set<string>();
  const withAnchors = (children: ReactNode) =>
    anchors.length > 0 ? applyAnchorsToTree(children, anchors, used) : children;

  const markdown = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className={`${compact ? 'mb-0 inline' : 'mb-2 last:mb-0'} whitespace-normal`}>
            {withAnchors(children)}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{withAnchors(children)}</li>,
        strong: ({ children }) => <strong className="font-semibold text-stone-900">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-teal-700 underline decoration-teal-600/40 underline-offset-2 hover:text-teal-800"
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = Boolean(className);
          if (isBlock) {
            return (
              <code
                className={`${className ?? ''} block font-mono text-[12.5px] leading-relaxed text-stone-100`}
              >
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[12.5px] text-stone-800">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-2 overflow-x-auto rounded-lg bg-stone-900 px-3 py-2.5 last:mb-0">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-stone-300 pl-3 text-stone-600 last:mb-0">
            {withAnchors(children)}
          </blockquote>
        ),
        h1: ({ children }) => (
          <h1 className="mb-2 text-base font-semibold text-stone-900 last:mb-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 text-sm font-semibold text-stone-900 last:mb-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1.5 text-sm font-semibold text-stone-900 last:mb-0">{children}</h3>
        ),
        hr: () => <hr className="my-3 border-stone-200" />,
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-left text-[13px]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-stone-200 bg-stone-50 px-2 py-1 font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-stone-200 px-2 py-1 align-top">{withAnchors(children)}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );

  if (compact) {
    return (
      <span className="chat-md max-w-none text-sm leading-relaxed text-stone-800">{markdown}</span>
    );
  }

  return (
    <div className="chat-md max-w-none text-sm leading-relaxed text-stone-800">{markdown}</div>
  );
}
