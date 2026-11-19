import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(
  resolve(root, "qq-chat-export-core/assets/modern_css.css"),
  "utf8",
);
await writeFile(
  resolve(root, "qce-v4-tool/public/log-editor/qce-chat.css"),
  "/* Generated from qq-chat-export-core/assets/modern_css.css. Run scripts/sync-log-editor-assets.mjs. */\n" +
    css.replace(/[ \t]+$/gm, ""),
);
