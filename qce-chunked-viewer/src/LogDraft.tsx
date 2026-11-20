import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DraftEntry, DraftFormat, ReviewDraft } from './qce/log-review';

export function LogDraft({ draft, onEdit, onExport, onClose }: {
  draft: ReviewDraft;
  onEdit: (entry: DraftEntry, text: string) => void;
  onExport: (format: DraftFormat) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState('');
  const [chapter, setChapter] = useState('');
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<DraftEntry | null>(null);
  const [text, setText] = useState('');
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number }>();
  const { project, entries } = draft;
  const people = useMemo(() => new Map(project.people.map(person => [person.id, person])), [project.people]);
  const visible = useMemo(() => project.messages.flatMap((message, n) => {
    const round = project.state.rounds[n] || '';
    return (!role || message.personId === role) && (!chapter || round === chapter) ? [n] : [];
  }), [project, role, chapter]);

  function clamp(left: number, top: number) {
    const root = panel.current?.offsetParent;
    const box = panel.current?.getBoundingClientRect();
    if (!root || !box) return { left, top };
    return {
      left: Math.max(0, Math.min(left, root.clientWidth - box.width)),
      top: Math.max(0, Math.min(top, root.clientHeight - box.height)),
    };
  }

  useEffect(() => {
    const root = panel.current?.offsetParent;
    if (!root) return;
    const observer = new ResizeObserver(() => setPlacement(previous => {
      if (!previous) return previous;
      const next = clamp(previous.left, previous.top);
      return next.left === previous.left && next.top === previous.top ? previous : next;
    }));
    observer.observe(root);
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);

  return <aside ref={panel} className="qce-log-draft" aria-label="成稿预览"
    style={placement && { ...placement, right: 'auto', bottom: 'auto' }}>
    <div className="qce-log-draft-bar">
      <button type="button" className="qce-log-draft-handle" aria-label="移动成稿" title="拖动成稿"
        onPointerDown={event => {
          if (event.button !== 0 || !panel.current) return;
          drag.current = { x: event.clientX, y: event.clientY, left: panel.current.offsetLeft, top: panel.current.offsetTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (start) setPlacement(clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y));
        }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
          if (!delta || !panel.current) return;
          event.preventDefault();
          setPlacement(clamp(panel.current.offsetLeft + delta[0]!, panel.current.offsetTop + delta[1]!));
        }}>成稿</button>
      <select aria-label="成稿角色" value={role} onChange={event => { setRole(event.target.value); setLimit(60); }}>
        <option value="">全部角色</option>
        {project.people.map(person => <option key={person.id} value={person.id}>{person.role}</option>)}
      </select>
      <select aria-label="成稿章节" value={chapter} onChange={event => { setChapter(event.target.value); setLimit(60); }}>
        <option value="">全部章节</option>
        {project.state.sections.map(round => <option key={round} value={round}>{round}</option>)}
      </select>
      <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
    </div>
    <div className="qce-log-draft-text">
      {visible.slice(0, limit).map((n, i) => {
        const message = project.messages[n]!;
        const entry = entries[n]!;
        const body = project.state.edits[n] ?? message.text;
        const round = project.state.rounds[n] ?? '';
        const previous = i > 0 ? project.state.rounds[visible[i - 1]!] ?? '' : '';
        return <Fragment key={entry.key + ':' + entry.index}>
          {round !== previous && <h2 className="qce-log-draft-round">{round || '未归类'}</h2>}
          <article>
            <header>【{people.get(message.personId)?.role || '系统'}】</header>
            {editing?.key === entry.key && editing.index === entry.index ? <form onSubmit={event => {
              event.preventDefault();
              if (!text.trim()) return;
              onEdit(entry, text);
              setEditing(null);
            }}>
              <textarea aria-label="成稿正文" value={text} onChange={event => setText(event.target.value)} autoFocus />
              <Button size="sm" type="submit" disabled={!text.trim()}>保存</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>取消</Button>
            </form> : <button type="button" className="qce-log-manuscript-line" onClick={() => { setEditing(entry); setText(body); }}>{body}</button>}
          </article>
        </Fragment>;
      })}
      {!visible.length && <p>此筛选下暂无成稿。</p>}
      {visible.length > limit && <Button size="sm" variant="outline" onClick={() => setLimit(limit + 60)}>显示更多</Button>}
    </div>
    <div className="qce-log-draft-bar">
      <span>导出整份成稿</span>
      <Button size="sm" variant="outline" onClick={() => onExport('txt')}>TXT</Button>
      <Button size="sm" variant="outline" onClick={() => onExport('md')}>Markdown</Button>
      <Button size="sm" variant="outline" onClick={() => onExport('html')}>HTML</Button>
    </div>
  </aside>;
}
