import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { FilteredDataSource, HyperScroll } from './hyperscroll';
import type { ChunkStore, QceManifest, QceRecord } from './qce/chunk-store';
import type { LogRecording } from './qce/log-workspace';
import {
  emptyReview, loadReviewRecord, makeReviewProject, outputDraft, renderLogRow,
  progressBackup, readProgressBackup, restoreReview, reviewBody, reviewKey, saveReviewFile,
  type Decision, type DraftEntry, type DraftFormat, type ReviewDraft, type ReviewProgress,
} from './qce/log-review';

type DragState = { id: number; index: number; x: number; y: number; started: boolean; end?: number };

export function useLogReview(store: RefObject<ChunkStore | null>, engine: RefObject<HyperScroll | null>, filter: RefObject<FilteredDataSource | null>, viewport: RefObject<HTMLDivElement | null>) {
  const [progress, setProgress] = useState(emptyReview);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [chapter, setChapter] = useState('');
  const [autoChapter, setAutoChapter] = useState(false);
  const [rangeMode, setRangeMode] = useState(false);
  const [edit, setEditState] = useState<{ index: number; text: string } | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const state = useRef(progress);
  const selection = useRef(selected);
  const storageKey = useRef('');
  const roleStorageKey = useRef('');
  const perSource = useRef(new Map<string, ReviewProgress>());
  const unfinishedEdits = useRef(new Map<string, NonNullable<typeof edit>>());
  const aliases = useRef<ReviewProgress['roles'] | undefined>(undefined);
  const undoStack = useRef<ReviewProgress[]>([]);
  const dragging = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => { engine.current?.refresh(); }, [engine, progress, selected]);

  function recordingProgress(manifest: QceManifest, initial?: ReviewProgress): ReviewProgress {
    const key = reviewKey(manifest);
    let saved = perSource.current.get(key);
    if (!saved) {
      saved = restoreReview(key, manifest.stats.totalMessages, initial);
      perSource.current.set(key, saved);
    }
    return { ...saved, roles: aliases.current ?? saved.roles };
  }

  function initialize(manifest: QceManifest, workspaceKey: string, initial?: ReviewProgress): number | null {
    storageKey.current = reviewKey(manifest);
    if (aliases.current === undefined) {
      roleStorageKey.current = workspaceKey + ':roles';
      try {
        const saved = localStorage.getItem(roleStorageKey.current);
        if (saved) aliases.current = JSON.parse(saved);
      } catch { /* Use the names from this recording. */ }
    }
    const restored = recordingProgress(manifest, initial);
    aliases.current = restored.roles;
    state.current = restored;
    setProgress(restored);
    undoStack.current = [];
    clearSelection();
    setEditState(unfinishedEdits.current.get(storageKey.current) ?? null);
    setStatus('');
    return restored.cursor;
  }

  function setEdit(next: typeof edit): void {
    if (next) unfinishedEdits.current.set(storageKey.current, next);
    else unfinishedEdits.current.delete(storageKey.current);
    setEditState(next);
  }

  function persist(key: string, next: ReviewProgress): void {
    perSource.current.set(key, next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setStatus('浏览器无法自动保存。关闭前请备份进度。');
    }
  }

  function commit(next: ReviewProgress, remember = true): void {
    if (remember) {
      undoStack.current.push(state.current);
      if (undoStack.current.length > 30) undoStack.current.shift();
    }
    if (aliases.current !== next.roles) {
      aliases.current = next.roles;
      try {
        localStorage.setItem(roleStorageKey.current, JSON.stringify(next.roles));
      } catch {
        setStatus('浏览器无法自动保存角色名称。');
      }
    }
    state.current = next;
    setProgress(next);
    persist(storageKey.current, next);
  }

  function includeRoles(recordings: LogRecording[]): void {
    const imported = Object.assign({}, ...recordings.map(recording => recording.initial?.roles ?? {}));
    if (Object.keys(imported).length > 0) commit({ ...state.current, roles: { ...imported, ...state.current.roles } }, false);
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

  function revealNext(index: number): void {
    viewport.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const view = viewport.current;
      const scroller = engine.current;
      if (!view || !scroller || state.current.cursor !== index) return;
      const visible = visiblePosition(index);
      if (visible < 0) return;
      const row = view.querySelector(`.hs-item[data-i="${index}"]`);
      const bounds = view.getBoundingClientRect();
      if (!row) {
        scroller.scrollToIndex(visible, -Math.round(bounds.height * .65));
        return;
      }
      const box = row.getBoundingClientRect();
      const margin = 12;
      if (box.height >= bounds.height - 2 * margin) {
        if (box.top >= bounds.bottom || box.bottom <= bounds.top) scroller.scrollBy(box.top - bounds.top - margin);
      } else if (box.bottom > bounds.bottom) {
        scroller.scrollBy(box.bottom - bounds.bottom + margin);
      } else if (box.top < bounds.top) {
        scroller.scrollBy(box.top - bounds.top - margin);
      }
    });
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
    if (next !== null) revealNext(next);
    else viewport.current?.focus({ preventScroll: true });
  }

  async function beginEdit(): Promise<void> {
    const index = currentIndex();
    const source = store.current;
    if (index === null || busy || !source) return;
    setBusy(true);
    try {
      const row = await loadReviewRecord(source, index);
      if (store.current !== source) return;
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

  function openRow(index: number): void {
    commit({ ...state.current, cursor: index }, false);
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
    return renderLogRow(index, row, html, state.current, store.current!.manifest, selection.current.has(index));
  }

  function saveProgress(): void {
    const manifest = store.current?.manifest;
    if (manifest) saveReviewFile(manifest.chat.name, 'qcelog', progressBackup(manifest, state.current));
  }

  async function openProgress(file: File): Promise<void> {
    const source = store.current;
    if (!source || busy) return;
    setBusy(true);
    try {
      const next = readProgressBackup(await file.text(), source.manifest);
      if (store.current !== source) return;
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

  function buildDraft(recordings: LogRecording[], title: string): Promise<ReviewDraft> {
    return makeReviewProject(title, recordings.filter(recording => recording.included).map(recording => ({
      key: recording.key, label: recording.label, store: recording.store,
      progress: recordingProgress(recording.store.manifest, recording.initial),
    })));
  }

  function refreshDraft(recordings: LogRecording[], title: string): () => void {
    let cancelled = false;
    void buildDraft(recordings, title).then(next => {
      if (!cancelled) setDraft(previous => previous ? next : null);
    }).catch(error => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : '无法更新成稿。');
    });
    return () => { cancelled = true; };
  }

  async function showDraft(recordings: LogRecording[], title: string, format?: DraftFormat): Promise<void> {
    if (busy || !store.current) return;
    setBusy(true);
    setStatus(format ? '正在生成文件…' : '正在生成成稿…');
    try {
      const result = await buildDraft(recordings, title);
      if (format) {
        saveReviewFile(title, format, outputDraft(result.project, format));
      } else setDraft(result);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法生成成稿。');
    } finally {
      setBusy(false);
    }
  }

  function updateDraftProgress(recording: LogRecording, update: (before: ReviewProgress) => ReviewProgress): void {
    const manifest = recording.store.manifest;
    const key = reviewKey(manifest);
    const before = recordingProgress(manifest, recording.initial);
    const next = update(before);
    if (next === before) return;
    if (key === storageKey.current) commit(next);
    else {
      persist(key, next);
      setDraftRevision(previous => previous + 1);
    }
  }

  function editDraft(recording: LogRecording, entry: DraftEntry, text: string): void {
    updateDraftProgress(recording, before => ({ ...before, edits: { ...before.edits, [entry.index]: text } }));
  }

  function linkDraftEntries(recording: LogRecording, entries: DraftEntry[]): void {
    updateDraftProgress(recording, before => {
      const members = new Set(entries.filter(entry => entry.key === recording.key && before.decisions[entry.index] === 'keep')
        .map(entry => entry.index));
      if (members.size < 2) return before;
      const exchanges = { ...before.exchanges };
      const group = Object.values(exchanges).reduce<number>((max, value) => Math.max(max, value ?? 0), 0) + 1;
      for (const index of members) exchanges[index] = group;
      return { ...before, exchanges };
    });
  }

  function unlinkDraftExchange(recording: LogRecording, group: number): void {
    updateDraftProgress(recording, before => ({
      ...before,
      exchanges: Object.fromEntries(Object.entries(before.exchanges ?? {}).filter(([, value]) => value !== group)),
    }));
  }

  return {
    progress, selected, initialize, chapter, setChapter, autoChapter, setAutoChapter, rangeMode, setRangeMode,
    edit, setEdit, cancelEdit, draft, setDraft, draftRevision, refreshDraft, status, busy, selectRow, clearSelection, decide, beginEdit,
    undo, canUndo: undoStack.current.length > 0, pointerDown, pointerMove, pointerEnd, assign, jumpChapter, openRow, renameRole,
    recordingProgress, includeRoles,
    decorate, saveProgress, openProgress, showDraft, editDraft, linkDraftEntries, unlinkDraftExchange,
  };
}
