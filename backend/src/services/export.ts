import fs from 'node:fs';
import path from 'node:path';
import type { MessageRow, SessionRow, ThreadRow } from '../db/init.js';
import { t } from '../i18n/index.js';
import { expandPath } from '../lib/paths.js';
import { getSettingsLocale } from './settings.js';
import type { ThreadNode } from './threads.js';

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'chat';
}

function roleLabel(role: MessageRow['role']): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
  }
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

function threadDirName(thread: ThreadRow): string {
  return `${shortId(thread.id)}-${slugify(thread.title)}`;
}

function threadFrontMatter(
  thread: ThreadRow,
  session: SessionRow,
  model: string,
  modelProfileName?: string,
): string {
  const exportedAt = new Date().toISOString();
  const lines = [
    '---',
    `title: ${JSON.stringify(thread.title)}`,
    `session_title: ${JSON.stringify(session.title)}`,
    `exported_at: ${JSON.stringify(exportedAt)}`,
    `model: ${JSON.stringify(model)}`,
  ];
  if (modelProfileName) {
    lines.push(`model_profile_name: ${JSON.stringify(modelProfileName)}`);
  }
  lines.push(
    `session_id: ${JSON.stringify(session.id)}`,
    `thread_id: ${JSON.stringify(thread.id)}`,
    `parent_thread_id: ${JSON.stringify(thread.parent_thread_id)}`,
    `anchor_message_id: ${JSON.stringify(thread.anchor_message_id)}`,
    `anchor_quote: ${JSON.stringify(thread.anchor_quote)}`,
    `include_upstream: ${thread.include_upstream === 1}`,
    `include_in_parent: ${thread.include_in_parent === 1}`,
    `include_all_descendants: ${thread.include_all_descendants === 1}`,
    '---',
    '',
  );
  return lines.join('\n');
}

function renderMessageBlock(message: MessageRow): string {
  const lines = [`## ${roleLabel(message.role)}`, ''];
  if (message.role === 'assistant' && message.model_label?.trim()) {
    lines.push(`model: ${JSON.stringify(message.model_label.trim())}`, '');
  }
  lines.push(message.content, '');
  return lines.join('\n');
}

function renderThreadMarkdown(input: {
  session: SessionRow;
  thread: ThreadNode;
  model: string;
  modelProfileName?: string;
  /** Relative links under this file for children keyed by child thread id */
  childLinks: Map<string, string>;
}): string {
  const front = threadFrontMatter(
    input.thread,
    input.session,
    input.model,
    input.modelProfileName,
  );
  const parts: string[] = [front];
  const locale = getSettingsLocale();

  if (input.thread.anchor_quote) {
    parts.push(t(locale, 'export.anchorQuote', { quote: input.thread.anchor_quote }));
  }

  for (const message of input.thread.messages) {
    parts.push(renderMessageBlock(message));

    // After the anchor message, list child threads that hang off this message
    for (const child of input.thread.children) {
      if (child.anchor_message_id === message.id) {
        const rel = input.childLinks.get(child.id);
        if (rel) {
          parts.push(t(locale, 'export.bypassLink', { title: child.title, rel }));
        }
      }
    }
  }

  // Children without matching message id still listed at end
  for (const child of input.thread.children) {
    const linked = input.thread.messages.some((m) => m.id === child.anchor_message_id);
    if (!linked) {
      const rel = input.childLinks.get(child.id);
      if (rel) {
        parts.push(`\n${t(locale, 'export.bypassLink', { title: child.title, rel })}`);
      }
    }
  }

  return parts.join('\n');
}

function writeThreadTree(input: {
  dir: string;
  session: SessionRow;
  node: ThreadNode;
  model: string;
  modelProfileName?: string;
  isRoot: boolean;
}): void {
  fs.mkdirSync(input.dir, { recursive: true });

  const childLinks = new Map<string, string>();
  for (const child of input.node.children) {
    const folder = threadDirName(child);
    childLinks.set(child.id, `./threads/${folder}/index.md`);
  }

  const markdown = renderThreadMarkdown({
    session: input.session,
    thread: input.node,
    model: input.model,
    modelProfileName: input.modelProfileName,
    childLinks,
  });
  fs.writeFileSync(path.join(input.dir, 'index.md'), markdown, 'utf8');

  if (input.node.children.length === 0) return;

  const threadsDir = path.join(input.dir, 'threads');
  fs.mkdirSync(threadsDir, { recursive: true });
  for (const child of input.node.children) {
    writeThreadTree({
      dir: path.join(threadsDir, threadDirName(child)),
      session: input.session,
      node: child,
      model: input.model,
      modelProfileName: input.modelProfileName,
      isRoot: false,
    });
  }
}

/** @deprecated flat single-file export — kept for tests; prefer writeExportTree */
export function buildMarkdownExport(input: {
  session: SessionRow;
  messages: MessageRow[];
  model: string;
}): string {
  const exportedAt = new Date().toISOString();
  const frontMatter = [
    '---',
    `title: ${JSON.stringify(input.session.title)}`,
    `exported_at: ${JSON.stringify(exportedAt)}`,
    `model: ${JSON.stringify(input.model)}`,
    `session_id: ${JSON.stringify(input.session.id)}`,
    '---',
    '',
  ].join('\n');

  const body = input.messages.map((message) => renderMessageBlock(message)).join('\n');

  return `${frontMatter}${body}`;
}

export function resolveExportPath(input: {
  session: SessionRow;
  exportDir: string;
  customPath?: string;
}): string {
  if (input.customPath?.trim()) {
    return expandPath(input.customPath.trim());
  }

  const dir = expandPath(input.exportDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Directory root for nested export tree
  const folderName = `${slugify(input.session.title)}-${timestamp}`;
  return path.join(dir, folderName);
}

export function writeExportFile(filePath: string, content: string): string {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function writeExportTree(input: {
  rootDir: string;
  session: SessionRow;
  threadTree: ThreadNode;
  model: string;
  modelProfileName?: string;
}): string {
  writeThreadTree({
    dir: input.rootDir,
    session: input.session,
    node: input.threadTree,
    model: input.model,
    modelProfileName: input.modelProfileName,
    isRoot: true,
  });
  return input.rootDir;
}
