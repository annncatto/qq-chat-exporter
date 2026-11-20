import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { FilteredDataSource, HyperScroll } from './hyperscroll';
import type { ChunkStore, QceManifest, QceRecord } from './qce/chunk-store';
import {
  emptyReview, escapeReviewText, loadReviewRecord, makeReviewProject, outputDraft,
  progressBackup, readProgressBackup, restoreReview, reviewBody, reviewKey, roleKey, saveReviewFile,
  type Decision, type DraftFormat, type ReviewDraft, type ReviewProgress,
} from './qce/log-review';

type DragState = { id: number; index: number; x: number; y: number; started: boolean; end?: number };

const keptMark = '<span class="qce-log-kept" role="img" aria-label="已保留" title="已保留">✓</span>';

function markKeptMessage(html: string): string {
  const avatar = /(<div class="message (?:self|other)"[^>]*>\s*)(<div class="avatar">[\s\S]*?<\/div>)/;
  const marked = html.replace(avatar, `$1<div class="qce-log-avatar">$2${keptMark}</div>`);
  if (marked !== html) return marked;
  return html.replace(/(<div class="system-message-container[^"]*"[^>]*>)/, `$1${keptMark}`);
}

export function useLogReview(store: RefObject<ChunkStore | null>, engine: RefObject<HyperScroll | null>, filter: RefObject<FilteredDataSource | null>, viewport: RefObject<HTMLDivElement | null>) {
  const [progress, setProgress] = useState(emptyReview);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [chapter, setChapter] = useState('');
  const [autoChapter, setAutoChapter] = useState(false);
  const [rangeMode, setRangeMode] = useState(false);
  const [edit, setEdit] = useState<{ index: number; text: string } | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const state = useRef(progress);
  const selection = useRef(selected);
  const storageKey = useRef('');
  const undoStack = useRef<ReviewProgress[]>([]);
  const dragging = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => { engine.current?.refresh(); }, [engine, progress, selected]);

  function initialize(manifest: QceManifest): number | null {
    storageKey.current = reviewKey(manifest);
    const restored = restoreReview(storageKey.current, manifest.stats.totalMessages);
    state.current = restored;
    setProgress(restored);
    return restored.cursor;
  }

  function commit(next: ReviewProgress, remember = true): void {
    if (remember) {
      undoStack.current.push(state.current);
      if (undoStack.current.length > 30) undoStack.current.shift();
    }
    state.current = next;
    setProgress(next);
    try {
      localStorage.setItem(storageKey.current, JSON.stringify(next));
    } catch {
      setStatus('浏览器无法自动保存。关闭前请备份进度。');
    }
  }

  function sourceIndex(position: number): number | null {
    if (position < 0 || position >= (filter.current?.count ?? store.current?.manifest.stats.totalMessages ?? 0)) return null;
    return filter.current?.sourceIndex(position) ?? position;
  }

  function visiblePosition(index: number): number {
    return filter.current?.indexOf(index) ?? index;
  }

  function currentIndex(): number | null {
    const index = state.current.cursor;
    if (index !== null) {
      const row = viewport.current?.querySelector(`[data-i="${index}"]`);
      if (row) {
        const box = row.getBoundingClientRect();
        const bounds = viewport.current!.getBoundingClientRect();
        if (box.bottom > bounds.top && box.top < bounds.bottom) return index;
      }
    }
    return sourceIndex(engine.current?.getStats().anchor.index ?? 0);
  }

  function reveal(index: number | null): void {
    if (index !== null) {
      const position = visiblePosition(index);
      if (position >= 0) engine.current?.scrollToIndex(position, -12);
    }
    viewport.current?.focus({ preventScroll: true });
  }

  function selectRow(index: number): void {
    if (suppressClick.current || edit) return;
    if (state.current.cursor !== index) commit({ ...state.current, cursor: index }, false);
    viewport.current?.focus({ preventScroll: true });
  }

  function clearSelection(): void {
    if (!selection.current.size) return;
    selection.current = new Set();
    setSelected(selection.current);
  }

  function decide(decision: Decision, editResult?: { index: number; text: string }): void {
    const index = editResult?.index ?? currentIndex();
    if (index === null || busy) return;
    const previous = state.current;
    const label = chapter.trim();
    if (autoChapter && !label) { setStatus('请填写当前章节或回合。'); return; }
    const position = visiblePosition(index);
    let next = sourceIndex(position + 1);
    if (!previous.decisions[index]) {
      while (next !== null && previous.decisions[next]) {
        const nextPosition = visiblePosition(next);
        next = sourceIndex(nextPosition + 1);
      }
    }
    setEdit(null);
    clearSelection();
    setStatus(next === null ? '已到当前列表末尾。' : '');
    commit({
      ...previous,
      cursor: next ?? index,
      decisions: { ...previous.decisions, [index]: decision },
      edits: editResult ? { ...previous.edits, [index]: editResult.text } : previous.edits,
      chapters: autoChapter ? { ...previous.chapters, [index]: label } : previous.chapters,
    });
    reveal(next ?? index);
  }

  async function beginEdit(): Promise<void> {
    const index = currentIndex();
    if (index === null || busy || !store.current) return;
    setBusy(true);
    try {
      const row = await loadReviewRecord(store.current, index);
      setEdit({ index, text: state.current.edits[index] ?? reviewBody(row) });
      selectRow(index);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法读取消息。');
    } finally {
      setBusy(false);
    }
  }

  function undo(): void {
    const previous = undoStack.current.pop();
    if (!previous) return;
    commit(previous, false);
    setStatus('');
    clearSelection();
    reveal(previous.cursor);
  }

  function cancelEdit(): void {
    setEdit(null);
    viewport.current?.focus({ preventScroll: true });
  }

  function range(start: number, end: number): void {
    const a = visiblePosition(start);
    const b = visiblePosition(end);
    if (a < 0 || b < 0) return;
    const ids = new Set<number>();
    for (let pos = Math.min(a, b); pos <= Math.max(a, b); pos++) {
      const index = sourceIndex(pos);
      if (index !== null) ids.add(index);
    }
    selection.current = ids;
    setSelected(ids);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (dragging.current || edit || event.button !== 0 || (event.pointerType === 'touch' && !rangeMode)) return;
    if (target.closest('a,button,input,textarea,label,select,[role="button"],.image-content img,.sticker-wrap,.forward-card')) return;
    const row = target.closest<HTMLElement>('.hs-item[data-i]');
    if (!row || row.querySelector('.skel-row')) return;
    dragging.current = { id: event.pointerId, index: Number(row.dataset.i), x: event.clientX, y: event.clientY, started: false };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.started = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    const viewport = event.currentTarget;
    const box = viewport.getBoundingClientRect();
    const x = Math.max(box.left + 3, Math.min(event.clientX, box.right - 3));
    const y = Math.max(box.top + 3, Math.min(event.clientY, box.bottom - 3));
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.hs-item[data-i]');
    if (row && viewport.contains(row)) {
      const end = Number(row.dataset.i);
      if (drag.end !== end) {
        drag.end = end;
        range(drag.index, end);
      }
    }
    if (y < box.top + 20) engine.current?.scrollBy(-20);
    if (y > box.bottom - 20) engine.current?.scrollBy(20);
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.started && event.type === 'pointerup') {
      pointerMove(event);
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (event.pointerType === 'touch') setRangeMode(false);
    }
    dragging.current = null;
  }

  function assign(): void {
    if (!chapter.trim() || !selection.current.size) return;
    const chapters = { ...state.current.chapters };
    for (const index of selection.current) chapters[index] = chapter.trim();
    commit({ ...state.current, chapters });
    clearSelection();
    setRangeMode(false);
    viewport.current?.focus({ preventScroll: true });
  }

  function jumpChapter(chapter: string): void {
    const match = Object.entries(state.current.chapters).find(([index, label]) => label === chapter && visiblePosition(Number(index)) >= 0);
    if (!match) { setStatus('当前筛选下没有此章节的消息。'); return; }
    const index = Number(match[0]);
    selectRow(index);
    reveal(index);
  }

  function renameRole(key: string, name: string): void {
    if ((state.current.roles[key] || '') === name.trim()) return;
    const roles = { ...state.current.roles };
    if (name.trim()) roles[key] = name.trim();
    else delete roles[key];
    commit({ ...state.current, roles });
  }

  function decorate(index: number, row: QceRecord, html: string): string {
    const current = state.current;
    const flags = (current.cursor === index ? ' qce-log-current' : '') + (selection.current.has(index) ? ' qce-log-selected' : '');
    const decision = current.decisions[index];
    const chapter = current.chapters[index];
    const edit = current.edits[index];
    const role = store.current && current.roles[roleKey(row, store.current.manifest)];
    const labels = [role, chapter, decision === 'exclude' ? '已排除' : ''].filter((s): s is string => !!s);
    const meta = labels.length ? `<div class="qce-log-message-meta">${labels.map(escapeReviewText).join(' · ')}</div>` : '';
    const updated = edit === undefined ? '' : `<div class="qce-log-edited">${escapeReviewText(edit)}</div>`;
    const message = decision === 'keep' ? markKeptMessage(html) : html;
    return `<div class="hs-item${flags}" data-i="${index}">${message}${meta}${updated}</div>`;
  }

  function saveProgress(): void {
    const manifest = store.current?.manifest;
    if (manifest) saveReviewFile(manifest.chat.name, 'qcelog', progressBackup(manifest, state.current));
  }

  async function openProgress(file: File): Promise<void> {
    const manifest = store.current?.manifest;
    if (!manifest || busy) return;
    setBusy(true);
    try {
      const next = readProgressBackup(await file.text(), manifest);
      setEdit(null);
      setDraft(null);
      clearSelection();
      setStatus('已恢复整理进度。');
      commit(next);
      reveal(next.cursor);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法恢复整理进度。');
    } finally {
      setBusy(false);
    }
  }

  async function showDraft(format?: DraftFormat): Promise<void> {
    if (busy || !store.current) return;
    setBusy(true);
    setStatus(format ? '正在生成文件…' : '正在生成成稿…');
    try {
      const source = store.current;
      const result = await makeReviewProject(source, state.current);
      if (format) {
        saveReviewFile(source.manifest.chat.name, format, outputDraft(result.project, format));
      } else setDraft(result);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法生成成稿。');
    } finally {
      setBusy(false);
    }
  }

  function editDraft(index: number, text: string): void {
    commit({ ...state.current, edits: { ...state.current.edits, [index]: text } });
  }

  return {
    progress, selected, initialize, chapter, setChapter, autoChapter, setAutoChapter, rangeMode, setRangeMode,
    edit, setEdit, cancelEdit, draft, setDraft, status, busy, selectRow, clearSelection, decide, beginEdit,
    undo, canUndo: undoStack.current.length > 0, pointerDown, pointerMove, pointerEnd, assign, jumpChapter, renameRole,
    decorate, saveProgress, openProgress, showDraft, editDraft,
  };
}
