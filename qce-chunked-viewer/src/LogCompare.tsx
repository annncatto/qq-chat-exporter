import { useEffect, useRef, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { HyperScroll } from './hyperscroll';
import { renderLogRow, type ReviewProgress } from './qce/log-review';
import type { LogRecording } from './qce/log-workspace';
import { installMediaFallback } from './qce/media-fallback';

export function LogCompare({ recordings, recording, progress, onChoose, onOpen, onClick, findMessage }: {
  recordings: LogRecording[];
  recording: LogRecording;
  progress: ReviewProgress;
  onChoose: (key: string) => void;
  onOpen: (index: number) => void;
  onClick: (event: MouseEvent<HTMLDivElement>, select: (index: number) => void, jump: (id: string) => void) => void;
  findMessage: (id: string) => Promise<number | null>;
}) {
  const view = useRef<HTMLDivElement>(null);
  const engine = useRef<HyperScroll | null>(null);
  const current = useRef(progress);
  const positions = useRef(new Map<string, { index: number; offset: number }>());
  current.current = progress;

  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const { store } = recording;
    const source = {
      count: store.manifest.stats.totalMessages,
      renderToString(index: number) {
        const row = store.get(index);
        if (!row) return `<div class="hs-item" data-i="${index}"><div class="skel-row"></div></div>`;
        // The main pane owns the document-level message and date IDs.
        const html = row.html.replace(/(<[^>]*?)\s+id="[^"]*"/g, '$1');
        return renderLogRow(index, row, html, { ...current.current, cursor: null }, store.manifest);
      },
    };
    const scroller = new HyperScroll(el, { dataSource: source });
    engine.current = scroller;
    const restore = positions.current.get(recording.key);
    if (restore) scroller.scrollToIndex(restore.index, restore.offset);
    const unsubscribe = store.subscribe(() => scroller.refresh());
    const stopMedia = installMediaFallback(el);
    return () => {
      positions.current.set(recording.key, scroller.getStats().anchor);
      unsubscribe();
      stopMedia();
      scroller.destroy();
      engine.current = null;
    };
  }, [recording.store, recording.key]);
  useEffect(() => { engine.current?.refresh(); }, [progress]);

  return <section className="qce-log-compare" aria-label="对照窗">
    <div className="qce-log-compare-tools">
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">对照</span>
        <select className="min-w-0 rounded border px-1 py-0.5" aria-label="对照记录" value={recording.key}
          onChange={event => onChoose(event.target.value)}>
          {recordings.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(engine.current?.getStats().anchor.index ?? 0)}>在主窗打开</Button>
    </div>
    <div ref={view} className="qce-viewport min-h-0 flex-1" tabIndex={0} aria-label="对照消息"
      onClick={event => onClick(event, onOpen, id => {
        void findMessage(id).then(index => {
          if (index !== null) engine.current?.scrollToIndex(index, -40);
        }).catch(() => undefined);
      })}
      onKeyDown={event => {
        if (event.target !== view.current) return;
        const scroller = engine.current;
        if (!scroller) return;
        const movement = { ArrowDown: 60, ArrowUp: -60, PageDown: view.current.clientHeight * .9, PageUp: -view.current.clientHeight * .9 }[event.key];
        if (movement === undefined) return;
        event.preventDefault();
        scroller.scrollBy(movement);
      }} />
  </section>;
}
