import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { LogRecording } from './qce/log-workspace';

export function LogSources({ recordings, active, busy, status, onOpen, onRename, onInclude, onImport }: {
  recordings: LogRecording[];
  active: LogRecording;
  busy: boolean;
  status: string;
  onOpen: (key: string) => void;
  onRename: (key: string, name: string) => void;
  onInclude: (key: string, included: boolean) => void;
  onImport: (files: File[], folder: boolean) => void;
}) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  return <details className="qce-log-sources mt-4 text-xs">
    <summary className="cursor-pointer font-medium">记录管理</summary>
    <ul className="mt-2 space-y-2" aria-label="整理记录">
      {recordings.map(recording => <li className="flex items-center gap-2" key={recording.key}>
        <button type="button" className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left hover:bg-accent"
          aria-current={active.key === recording.key ? 'true' : undefined} title={recording.label}
          onClick={() => onOpen(recording.key)}>{recording.label}</button>
        <label className="flex shrink-0 items-center gap-1">
          <input type="checkbox" aria-label={`将 ${recording.label} 纳入成稿`} checked={recording.included}
            onChange={event => onInclude(recording.key, event.currentTarget.checked)} />
          纳入成稿
        </label>
      </li>)}
    </ul>
    <label className="mt-2 block">
      当前记录名称
      <input className="mt-1 w-full rounded border px-2 py-1" type="text" key={active.key + active.label}
        defaultValue={active.label} maxLength={80} onBlur={event => onRename(active.key, event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </label>
    <div className="mt-2 flex flex-wrap gap-1">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => files.current?.click()}>导入记录</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => folder.current?.click()}>导入流式文件夹</Button>
      <input type="file" ref={files} hidden multiple aria-label="选择记录文件" accept=".html,.htm,.json,.jsonl,.txt,.qcelog" onChange={event => {
        onImport(Array.from(event.currentTarget.files ?? []), false);
        event.currentTarget.value = '';
      }} />
      <input type="file" ref={element => {
        folder.current = element;
        element?.setAttribute('webkitdirectory', '');
      }} hidden aria-label="选择流式导出目录" onChange={event => {
        onImport(Array.from(event.currentTarget.files ?? []), true);
        event.currentTarget.value = '';
      }} />
    </div>
    {status && <p className="mt-2 text-muted-foreground" role="status">{status}</p>}
  </details>;
}
