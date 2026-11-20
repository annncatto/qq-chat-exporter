import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { HyperScroll } from './hyperscroll';
import type { QceRecord } from './qce/chunk-store';
import type { LogRecording } from './qce/log-workspace';
import { installMediaFallback } from './qce/media-fallback';

export function LogCompare({ recordings, recording, decorate, rangeMode, onChoose, onOpen, onClick, onActivate, onSelect,
  onKeyDown, onPointerDown, onPointerMove, onPointerEnd, findMessage, engine, view }: {
  recordings: LogRecording[];
  recording: LogRecording;
  decorate: (index: number, row: QceRecord, html: string) => string;
  rangeMode: boolean;
  onChoose: (key: string) => void;
  onOpen: (index: number) => void;
  onClick: (event: MouseEvent<HTMLDivElement>, select: (index: number) => void, jump: (id: string) => void) => void;
  onActivate: () => void;
  onSelect: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, jump: (id: string) => void) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: PointerEvent<HTMLDivElement>) => void;
  findMessage: (id: string) => Promise<number | null>;
  engine: RefObject<HyperScroll | null>;
  view: RefObject<HTMLDivElement | null>;
}) {
  const decorateRef = useRef(decorate);
  const positions = useRef(new Map<string, { index: number; offset: number }>());
  decorateRef.current = decorate;

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
        return decorateRef.current(index, row, html);
      },
    };
    const scroller = new HyperScroll(el, { dataSource: source, keyboard: true });
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
  }, [recording.store, recording.key, engine, view]);

  function jump(id: string): void {
    const scroller = engine.current;
    void findMessage(id).then(index => {
      if (index !== null && engine.current === scroller) scroller?.scrollToIndex(index, -40);
    }).catch(() => undefined);
  }

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
    <div ref={view} className={`qce-viewport min-h-0 flex-1${rangeMode ? ' qce-log-range' : ''}`} tabIndex={0} aria-label="对照消息"
      onFocus={onActivate}
      onClick={event => onClick(event, onSelect, jump)}
      onKeyDown={event => onKeyDown(event, jump)}
      onPointerDown={event => {
        if (event.button === 0) onActivate();
        onPointerDown(event);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd} />
  </section>;
}
