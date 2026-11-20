import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DraftFormat, ReviewDraft } from './qce/log-review';

export function LogDraft({ draft, onEdit, onExport, onClose }: {
  draft: ReviewDraft;
  onEdit: (index: number, text: string) => void;
  onExport: (format: DraftFormat) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState('');
  const [chapter, setChapter] = useState('');
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [modified, setModified] = useState<Partial<Record<number, string>>>({});
  const { project, indices } = draft;
  const people = useMemo(() => new Map(project.people.map(person => [person.id, person])), [project.people]);
  const visible = useMemo(() => project.messages.flatMap((message, n) => {
    const round = project.state.rounds[n] || '';
    return (!role || message.personId === role) && (!chapter || round === chapter) ? [n] : [];
  }), [project, role, chapter]);

  return <aside className="qce-log-draft" aria-label="成稿预览">
    <div className="qce-log-draft-bar">
      <strong>成稿</strong>
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
      {visible.slice(0, limit).map(n => {
        const message = project.messages[n]!;
        const body = modified[n] ?? project.state.edits[n] ?? message.text;
        return <article key={n}>
          <header>【{people.get(message.personId)?.role || '系统'}】</header>
          {editing === n ? <form onSubmit={event => {
            event.preventDefault();
            if (!text.trim()) return;
            onEdit(indices[n]!, text);
            setModified(previous => ({ ...previous, [n]: text }));
            setEditing(null);
          }}>
            <textarea aria-label="成稿正文" value={text} onChange={event => setText(event.target.value)} autoFocus />
            <Button size="sm" type="submit" disabled={!text.trim()}>保存</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>取消</Button>
          </form> : <button type="button" className="qce-log-manuscript-line" onClick={() => { setEditing(n); setText(body); }}>{body}</button>}
        </article>;
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
