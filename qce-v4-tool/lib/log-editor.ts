import type { ExportTask } from "@/types/api";

/** The first editor entry point accepts ordinary, lossless QCE JSON exports. */
export function logEditorSourcePath(task: ExportTask): string | null {
  if (task.status !== "completed") return null;
  const path = task.originalFilePath || task.filePath;
  if (path && /\.json$/i.test(path)) return path;
  return null;
}
