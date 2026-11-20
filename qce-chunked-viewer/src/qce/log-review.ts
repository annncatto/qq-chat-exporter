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

interface PortableProject {
  people: Array<{ id: string; qq: string; uid: string; name: string; role: string }>;
  messages: Array<{ personId: string; text: string }>;
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
    parse(text: string): PortableProject;
    output(project: PortableProject, format: DraftFormat): string;
    escapeHTML(text: string): string;
  };
}).LogEditorCore;

export const escapeReviewText = core.escapeHTML;
export const outputDraft = core.output;
export type ReviewDraft = { project: PortableProject; indices: number[] };

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

export function restoreReview(key: string, total: number): ReviewProgress {
  try {
    const saved = localStorage.getItem(key);
    return saved ? decodeProgress(JSON.parse(saved), total) : emptyReview();
  } catch {
    return emptyReview();
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

export async function makeReviewProject(store: ChunkStore, progress: ReviewProgress): Promise<ReviewDraft> {
  const indices = Object.keys(progress.decisions).map(Number).filter(index => progress.decisions[index] === 'keep').sort((a, b) => a - b);
  if (!indices.length) throw new Error('请先保留要写入成稿的消息。');
  if (indices.length > 200000) throw new Error('成稿最多可包含 20 万条消息。');
  const messages = [];
  const roles = new Map<string, string>();
  let loadedChunk = -1;
  let loadedRows: QceRecord[] = [];
  for (const index of indices) {
    const chunk = store.chunkOf(index);
    if (loadedChunk !== chunk) {
      loadedRows = await store.load(chunk);
      loadedChunk = chunk;
    }
    const row = loadedRows[index - store.chunkStarts[chunk]!];
    if (!row) throw new Error(`无法读取第 ${index + 1} 条消息。`);
    const key = roleKey(row, store.manifest);
    const qq = key.startsWith('qq:') ? key.slice(3) : undefined;
    const alias = progress.roles[key];
    if (alias) roles.set(key, alias);
    messages.push({
      id: row.id, time: row.ts > 0 ? new Date(row.ts).toLocaleString('zh-CN', { hour12: false }) : row.date,
      timestamp: row.ts, sender: { uid: row.uid, uin: qq, name: row.name || '系统' },
      content: { text: reviewBody(row) },
    });
  }
  const project = core.parse(JSON.stringify({ chatInfo: store.manifest.chat, messages }));
  for (const person of project.people) {
    const key = person.qq ? `qq:${person.qq}` : `uid:${person.uid}`;
    person.role = roles.get(key) || person.role;
  }
  indices.forEach((index, offset) => {
    project.state.decisions[offset] = progress.decisions[index] || 'pending';
    if (progress.edits[index] !== undefined) project.state.edits[offset] = progress.edits[index];
    if (progress.chapters[index]) project.state.rounds[offset] = progress.chapters[index];
  });
  project.state.sections = [...new Set(Object.values(project.state.rounds).filter((s): s is string => !!s))];
  return { project, indices };
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
