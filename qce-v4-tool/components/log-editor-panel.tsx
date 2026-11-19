"use client";

import { useEffect, useRef, useState } from "react";
import type { ExportTask } from "@/types/api";
import AuthManager from "@/lib/auth";
import { logEditorSourcePath } from "@/lib/log-editor";

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export function LogEditorPanel({ task }: { task: ExportTask | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(850);
  const [flowMode, setFlowMode] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(!!task);
  const [retry, setRetry] = useState(0);
  const taskId = useRef(task?.id);
  taskId.current = task?.id;

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (
        event.data?.type === "qce-log-editor:flow" &&
        typeof event.data.enabled === "boolean"
      )
        setFlowMode(event.data.enabled);
      if (event.data?.type === "qce-log-editor:ready") setReady(true);
      if (
        event.data?.type === "qce-log-editor:loaded" &&
        event.data.taskId === taskId.current
      )
        setOpening(false);
      if (
        event.data?.type === "qce-log-editor:error" &&
        event.data.taskId === taskId.current
      )
        setOpening(false);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const resize = () =>
      setHeight(
        Math.max(
          420,
          window.innerHeight -
            (container.current?.getBoundingClientRect().top ?? 64),
        ),
      );
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [opening]);

  useEffect(() => {
    if (!ready || !task) return;
    const path = logEditorSourcePath(task);
    if (!path) {
      setError("请打开 JSON 导出记录。");
      setOpening(false);
      return;
    }
    const controller = new AbortController();
    setOpening(true);
    setError("");
    const load = async () => {
      try {
        const token = AuthManager.getInstance().getToken();
        const response = await fetch(
          `/api/download-file?path=${encodeURIComponent(path)}`,
          {
            headers: token
              ? { Authorization: `Bearer ${token}`, "X-Access-Token": token }
              : undefined,
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(`读取导出记录失败（${response.status}）`);
        if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES)
          throw new Error("记录超过 64 MB，请按日期分段导出。");
        const text = await response.text();
        if (new Blob([text]).size > MAX_SOURCE_BYTES)
          throw new Error("记录超过 64 MB，请按日期分段导出。");
        if (!controller.signal.aborted && taskId.current === task.id)
          frame.current?.contentWindow?.postMessage(
            {
              type: "qce-log-editor:source",
              text,
              name: path.split(/[\\/]/).pop(),
              taskId: task.id,
            },
            window.location.origin,
          );
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "打开记录失败");
          setOpening(false);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [ready, task, retry]);

  const src =
    process.env.NODE_ENV === "production"
      ? "/static/qce/log-editor/index.html"
      : "/log-editor/index.html";
  return (
    <section
      ref={container}
      className="min-w-0"
      aria-label="跑团 log 整理工作区"
    >
      {opening && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          正在打开记录…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="underline underline-offset-4"
          >
            重试
          </button>
        </div>
      )}
      <iframe
        ref={frame}
        src={src}
        onLoad={() => setReady(true)}
        hidden={opening}
        allowFullScreen
        title="跑团 log 整理"
        className="w-full border-0"
        style={
          flowMode
            ? { position: "fixed", inset: 0, height: "100dvh", zIndex: 100 }
            : { height }
        }
      />
    </section>
  );
}
