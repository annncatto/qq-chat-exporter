import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../qce-v4-tool");
const source = resolve(root, "public/log-editor");
let html = await readFile(resolve(source, "index.html"), "utf8");
const css = await readFile(resolve(source, "style.css"), "utf8");
const sharedCss = await readFile(
  resolve(root, "../qq-chat-export-core/assets/modern_css.css"),
  "utf8",
);
const core = await readFile(resolve(source, "core.js"), "utf8");
const app = await readFile(resolve(source, "app.js"), "utf8");
const manuscript = await readFile(resolve(source, "manuscript.js"), "utf8");
const viewport = await readFile(resolve(source, "viewport.js"), "utf8");
html = html.replace(
  /<link rel="stylesheet" href="style\.css"\s*\/?>/,
  () => `<style>${css}</style>`,
);
html = html.replace(
  /<link rel="stylesheet" href="qce-chat\.css"\s*\/?>/,
  () => `<style>${sharedCss}</style>`,
);
html = html.replace(
  /\s*<script src="(?:core|viewport|manuscript|app)\.js" defer><\/script>/g,
  "",
);
html = html.replace(
  "</body>",
  () =>
    `<script>${(core + "\n" + viewport + "\n" + manuscript + "\n" + app).replaceAll("</script", "<\\/script")}</script></body>`,
);
await mkdir(resolve(root, "out"), { recursive: true });
const output = resolve(root, "out/log-editor-standalone.html");
await writeFile(output, html);
console.log(output);
