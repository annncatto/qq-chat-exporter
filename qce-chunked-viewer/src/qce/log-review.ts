import './log-core.js';
import type { ChunkStore, QceManifest, QceRecord } from './chunk-store';

export type Decision = 'keep' | 'exclude';
export type DraftFormat = 'txt' | 'md' | 'html';

export interface ReviewProgress {
  decisions: Partial<Record<number, Decision>>;
  edits: Partial<Record<number, string>>;
  chapters: Partial<Record<number, string>>;
  roles: Partial<Record<string, string>>;
  cursor: number | null;
}

export interface PortableProject {
  title: string;
  windows: Array<{ id: string; name: string; enabled: boolean; selfUin?: string; selfUid?: string }>;
  people: Array<{ id: string; qq: string; uid: string; name: string; role: string }>;
  messages: Array<{ personId: string; text: string; time: string; timestamp: number; sourceId: string; windowId: string; original?: { system?: boolean } }>;
  state: {
    decisions: Array<Decision | 'pending'>;
    edits: Partial<Record<number, string>>;
    rounds: Partial<Record<number, string>>;
    sections: string[];
    current: number | null;
  };
}

const core = (globalThis as typeof globalThis & {
  LogEditorCore: {
    parse(text: string, filename?: string): PortableProject;
    output(project: PortableProject, format: DraftFormat): string;
    escapeHTML(text: string): string;
  };
}).LogEditorCore;

export const escapeReviewText = core.escapeHTML;
export const outputDraft = core.output;
export const parseLogProject = core.parse;
export interface DraftEntry { key: string; index: number }
export interface DraftInput { key: string; store: ChunkStore; progress: ReviewProgress }
export type ReviewDraft = { project: PortableProject; entries: DraftEntry[] };

export function emptyReview(): ReviewProgress {
  return { decisions: {}, edits: {}, chapters: {}, roles: {}, cursor: null };
}

export function reviewKey(manifest: QceManifest): string {
  const { chat, exportTime, stats, chunks } = manifest;
  return 'qce-html-log-v1:' + JSON.stringify([
    exportTime, chat.type, chat.peerUid, chat.peerUin, chat.name, stats.totalMessages,
    chunks[0]?.firstMsgId, chunks[chunks.length - 1]?.lastMsgId,
  ]);
}

function decodeProgress(value: ReviewProgress | null, total: number): ReviewProgress {
  if (!value || typeof value !== 'object') return emptyReview();
  const entries = (data: unknown) => data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data) : [];
  const validIndex = (index: unknown): index is number => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < total;
  const indexed = (data: unknown) => entries(data).filter(([index]) => /^\d+$/.test(index) && validIndex(Number(index)));
  return {
    decisions: Object.fromEntries(indexed(value.decisions).filter(([, decision]) => decision === 'keep' || decision === 'exclude')),
    edits: Object.fromEntries(indexed(value.edits).filter(([, text]) => typeof text === 'string')),
    chapters: Object.fromEntries(indexed(value.chapters).filter(([, chapter]) => typeof chapter === 'string')),
    roles: Object.fromEntries(entries(value.roles).filter(([name, alias]) => /^(qq|uid):/.test(name) && typeof alias === 'string')),
    cursor: validIndex(value.cursor) ? value.cursor : null,
  };
}

export function restoreReview(key: string, total: number, initial = emptyReview()): ReviewProgress {
  try {
    const saved = localStorage.getItem(key);
    return saved ? decodeProgress(JSON.parse(saved), total) : initial;
  } catch {
    return initial;
  }
}

export function progressBackup(manifest: QceManifest, progress: ReviewProgress): string {
  return JSON.stringify({ format: 'qce-html-log-progress-v1', source: reviewKey(manifest), progress });
}

export function readProgressBackup(text: string, manifest: QceManifest): ReviewProgress {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('无法读取整理进度文件。');
  }
  if (backup?.format !== 'qce-html-log-progress-v1' || typeof backup.progress !== 'object' || !backup.progress || Array.isArray(backup.progress)) {
    throw new Error('请选择通过「备份进度」保存的文件。');
  }
  if (backup.source !== reviewKey(manifest)) throw new Error('请打开生成这份备份的 HTML 记录。');
  return decodeProgress(backup.progress, manifest.stats.totalMessages);
}

const senderAccounts = new WeakMap<QceManifest, Map<string, string>>();

export function roleKey(record: Pick<QceRecord, 'uin' | 'uid'>, manifest: QceManifest): string {
  let accounts = senderAccounts.get(manifest);
  if (!accounts) {
    accounts = new Map();
    for (const sender of manifest.senders) {
      const qq = sender.avatar?.match(/^https:\/\/q\.qlogo\.cn\/g\?[^#]*\bnk=([1-9]\d{3,11})(?:&|$)/)?.[1];
      if (qq) accounts.set(sender.uid, qq);
    }
    senderAccounts.set(manifest, accounts);
  }
  const knownQq = record.uin || accounts.get(record.uid);
  return knownQq ? `qq:${knownQq}` : record.uid ? `uid:${record.uid}` : '';
}

export function roleAlias(record: Pick<QceRecord, 'uin' | 'uid'>, manifest: QceManifest, aliases: ReviewProgress['roles']): string | undefined {
  return aliases[roleKey(record, manifest)] || aliases[`uid:${record.uid}`];
}

const keptMark = '<span class="qce-log-kept" role="img" aria-label="已保留" title="已保留">✓</span>';

function markKeptMessage(html: string): string {
  const avatar = /(<div class="message (?:self|other)"[^>]*>\s*)(<div class="avatar">[\s\S]*?<\/div>)/;
  const marked = html.replace(avatar, `$1<div class="qce-log-avatar">$2${keptMark}</div>`);
  if (marked !== html) return marked;
  return html.replace(/(<div class="system-message-container[^"]*"[^>]*>)/, `$1${keptMark}`);
}

export function renderLogRow(index: number, row: QceRecord, html: string, progress: ReviewProgress, manifest: QceManifest, selected = false): string {
  const flags = (progress.cursor === index ? ' qce-log-current' : '') + (selected ? ' qce-log-selected' : '');
  const decision = progress.decisions[index];
  const chapter = progress.chapters[index];
  const edit = progress.edits[index];
  const role = roleAlias(row, manifest, progress.roles);
  const labels = [chapter, decision === 'exclude' ? '已排除' : ''].filter((s): s is string => !!s);
  const meta = labels.length ? `<div class="qce-log-message-meta">${labels.map(escapeReviewText).join(' · ')}</div>` : '';
  const updated = edit === undefined ? '' : `<div class="qce-log-edited">${escapeReviewText(edit)}</div>`;
  let message = role
    ? html.replace(/(<div class="message-header">\s*(?:<span class="sender-title">[^<]*<\/span>\s*)?)<span class="sender">[^<]*<\/span>/,
      (_, header: string) => `${header}<span class="sender" title="${escapeReviewText(row.name)}">${escapeReviewText(role)}</span>`)
    : html;
  if (decision === 'keep') message = markKeptMessage(message);
  return `<div class="hs-item${flags}" data-i="${index}">${message}${meta}${updated}</div>`;
}

export function reviewBody(record: QceRecord): string {
  if (record.logText) return record.logText;
  const fragment = document.createElement('template');
  fragment.innerHTML = record.html;
  const body = fragment.content.querySelector('.message-bubble .content, .system-message-container');
  body?.querySelectorAll('br').forEach(line => line.replaceWith('\n'));
  body?.querySelector('.system-message-time')?.remove();
  const text = body?.textContent?.trim();
  const media: Record<string, string> = { img: '图片', video: '视频', voice: '语音', file: '文件', sticker: '表情' };
  if (text) return text;
  const label = media[record.kind];
  return label ? `[${label}]` : record.text || '[非文本消息]';
}

export async function loadReviewRecord(store: ChunkStore, index: number): Promise<QceRecord> {
  const chunk = store.chunkOf(index);
  const rows = await store.load(chunk);
  const row = rows[index - store.chunkStarts[chunk]!];
  if (!row) throw new Error(`无法读取第 ${index + 1} 条消息。`);
  return row;
}

export async function makeReviewProject(title: string, inputs: DraftInput[]): Promise<ReviewDraft> {
  const selected = inputs.flatMap(input => Object.keys(input.progress.decisions).map(Number)
    .filter(index => input.progress.decisions[index] === 'keep').sort((a, b) => a - b)
    .map(index => ({ input, index })));
  if (!selected.length) throw new Error('请先保留要写入成稿的消息。');
  if (selected.length > 200000) throw new Error('成稿最多可包含 20 万条消息。');
  const rows = [];
  let loadedStore: ChunkStore | undefined;
  let loadedChunk = -1;
  let loadedRows: QceRecord[] = [];
  for (const { input, index } of selected) {
    const { store } = input;
    const chunk = store.chunkOf(index);
    if (store !== loadedStore || loadedChunk !== chunk) {
      loadedRows = await store.load(chunk);
      loadedStore = store;
      loadedChunk = chunk;
    }
    const row = loadedRows[index - store.chunkStarts[chunk]!];
    if (!row) throw new Error(`无法读取第 ${index + 1} 条消息。`);
    const role = roleKey(row, store.manifest);
    rows.push({ input, index, message: {
      id: row.id, time: row.ts > 0 ? new Date(row.ts).toLocaleString('zh-CN', { hour12: false }) : row.date,
      timestamp: row.ts, sender: { uid: row.uid, uin: role.startsWith('qq:') ? role.slice(3) : undefined, name: row.name || '系统' },
      content: { text: reviewBody(row) },
    } });
  }
  if (rows.every(({ message }) => message.timestamp > 0)) rows.sort((a, b) => a.message.timestamp - b.message.timestamp);
  const project = core.parse(JSON.stringify({ chatInfo: { name: title }, messages: rows.map(row => row.message) }));
  const roles = inputs[0]!.progress.roles;
  for (const person of project.people) {
    const key = person.qq ? `qq:${person.qq}` : `uid:${person.uid}`;
    person.role = roles[key] || roles[`uid:${person.uid}`] || person.role;
  }
  rows.forEach(({ input: { progress }, index }, offset) => {
    project.state.decisions[offset] = 'keep';
    if (progress.edits[index] !== undefined) project.state.edits[offset] = progress.edits[index];
    if (progress.chapters[index]) project.state.rounds[offset] = progress.chapters[index];
  });
  project.state.sections = [...new Set(Object.values(project.state.rounds).filter((s): s is string => !!s))];
  return { project, entries: rows.map(({ input, index }) => ({ key: input.key, index })) };
}

export function saveReviewFile(title: string, extension: string, text: string): void {
  const mime = extension === 'html' ? 'text/html' : extension === 'qcelog' ? 'application/json' : 'text/plain';
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)}.${extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
