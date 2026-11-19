import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ video: "off" });

const BASE = process.env.E2E_FRONTEND_URL || "http://127.0.0.1:3000";
const EDITOR = `${BASE}/static/qce/log-editor/index.html`;
const fixture = {
  chatInfo: { name: "验证团" },
  messages: [
    {
      id: "1",
      time: "2026-11-19 20:00:00",
      sender: { uin: "10001", uid: "u_1", name: "主持人" },
      content: { text: "你们来到门前。" },
    },
    {
      id: "2",
      time: "2026-11-19 20:01:00",
      sender: { uin: "10002", uid: "u_2", name: "昵称甲" },
      content: { text: "我站再门边。" },
    },
    {
      id: "3",
      time: "2026-11-19 20:02:00",
      sender: { uid: "u_2", name: "改过的昵称" },
      content: { text: "（等一下）" },
    },
    {
      id: "4",
      time: "2026-11-19 20:03:00",
      sender: { uin: "10001", uid: "u_1", name: "主持人" },
      content: { text: "门慢慢打开。" },
    },
  ],
};

async function importFixture(page: Page) {
  await page.goto(EDITOR);
  await page.locator("#rr-file").setInputFiles({
    name: "记录.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator("#rr-title")).toHaveText("验证团");
}

test("real file review, identity binding, draft recovery, grouping and portable export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await importFixture(page);
  await page.locator("#rr-keep").click();
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "2");
  await page.getByRole("textbox", { name: "角色名" }).fill("林雾");
  await page.getByRole("textbox", { name: "角色名" }).press("Tab");
  await page.keyboard.press("e");
  await page.locator("#rr-draft").fill("我站在门边。");
  await expect(page.locator("#rr-save")).toHaveText("已自动保存");
  await page.reload();
  await expect(page.locator("#rr-draft")).toHaveValue("我站在门边。");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "3");
  await expect(page.getByRole("textbox", { name: "角色名" })).toHaveValue(
    "林雾",
  );
  await page.keyboard.press("s");
  await page.keyboard.press("a");
  await expect(page.locator("#rr-progress")).toHaveText("已确认 4 / 4");
  await page.locator("#rr-sidebar > summary").click();
  await page.locator("#rr-unassigned").click();
  await page.locator("#rr-select-all").check();
  await page.locator("#rr-round").fill("第1回合");
  await page.locator("#rr-round").press("Enter");
  await expect(page.locator("#rr-unassigned-count")).toHaveText("0");
  await expect(page.locator("#rr-progress")).toHaveText("已确认 4 / 4");
  await page.locator("#rr-draft-view").click();
  await expect(page.locator(".r-scroll")).toContainText("我站在门边。");
  await expect(page.locator(".r-scroll")).not.toContainText("等一下");
  const projectDownload = page.waitForEvent("download");
  await page.locator("#rr-open-menu > summary").click();
  await page.locator("#rr-save-project").click();
  const downloaded = await projectDownload;
  const packed = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  expect(packed.original).toEqual(fixture);
  expect(packed.state.decisions).toEqual(["keep", "keep", "exclude", "keep"]);
  expect(packed.state.rounds).toEqual({
    0: "第1回合",
    1: "第1回合",
    3: "第1回合",
  });
  await page.locator("#rr-file").setInputFiles({
    name: "工程.qcelog",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(packed)),
  });
  await expect(page.locator("#rr-progress")).toHaveText("已确认 4 / 4");
  await page.locator("#rr-file").setInputFiles({
    name: "损坏.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"messages":['),
  });
  await expect(page.locator("#rr-error")).toBeVisible();
  await expect(page.locator("#rr-progress")).toHaveText("已确认 4 / 4");
  await page.locator("#rr-export-menu summary").click();
  const textDownload = page.waitForEvent("download");
  await page.locator('[data-export="txt"]').click();
  const text = await readFile((await (await textDownload).path())!, "utf8");
  expect(text).toContain("林雾：");
  expect(text).toContain("我站在门边。");
  expect(text).not.toContain("等一下");
  expect(errors).toEqual([]);
});

test("manual jumps, held keys and grouping never confirm unread messages", async ({
  page,
}) => {
  await importFixture(page);
  await page.locator("#rr-search").fill("#4");
  await page.locator("#rr-search").press("Enter");
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "4");
  await expect(page.locator("#rr-progress")).toHaveText("已确认 0 / 4");
  await page.locator("#rr-return").click();
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "1");
  await page.locator("#rr-round").fill("第2回合");
  await page.locator("#rr-round").press("Enter");
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "1");
  await expect(page.locator("#rr-progress")).toHaveText("已确认 0 / 4");
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true }),
    ),
  );
  await expect(page.locator("#rr-progress")).toHaveText("已确认 0 / 4");
  await page.keyboard.press("a");
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "2");
  await expect(page.locator("#rr-round")).toHaveValue("第2回合");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".r-current")).toHaveAttribute("data-message", "1");
  await expect(page.locator("#rr-progress")).toHaveText("已确认 0 / 4");
});

test("consecutive source handoffs keep the most recently selected task", async ({
  page,
}) => {
  await page.goto(EDITOR);
  await expect(page.locator("#rr-open-empty")).toBeVisible();
  await page.evaluate((data) => {
    for (const [taskId, title] of [
      ["task-a", "第一份"],
      ["task-b", "第二份"],
    ])
      window.postMessage(
        {
          type: "qce-log-editor:source",
          name: "记录.json",
          taskId,
          text: JSON.stringify({ ...data, chatInfo: { name: title } }),
        },
        location.origin,
      );
  }, fixture);
  await expect(page.locator("#rr-progress")).toHaveText("已确认 0 / 8");
  await expect(page.locator("#rr-scope")).toHaveText("第二份");
});

test("mobile review fits a narrow touch screen", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await importFixture(page);
    const width = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    await page.locator("#rr-keep").click();
    await expect(page.locator(".r-current")).toHaveAttribute(
      "data-message",
      "2",
    );
  } finally {
    await context.close();
  }
});

test("storage failure preserves the current project until a portable backup is saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      value: {
        open() {
          throw new Error("storage unavailable");
        },
      },
    });
  });
  await importFixture(page);
  await expect(page.locator("#rr-save")).toHaveText("未自动保存，请保存工程");
  await page.locator("#rr-keep").click();
  const other = { ...fixture, chatInfo: { name: "另一团" } };
  await page.locator("#rr-file").setInputFiles({
    name: "另一团.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(other)),
  });
  await expect(page.locator("#rr-error")).toContainText("请先保存工程");
  await expect(page.locator("#rr-title")).toHaveText("验证团");
  const backup = page.waitForEvent("download");
  await page.locator("#rr-open-menu > summary").click();
  await page.locator("#rr-save-project").click();
  await backup;
  await page.locator("#rr-file").setInputFiles({
    name: "另一团.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(other)),
  });
  await expect(page.locator("#rr-progress")).toHaveText("已确认 1 / 8");
});

test("QCE export enters editing directly and keeps its workspace when changing tabs", async ({
  page,
}) => {
  let created = false;
  let exports = 0;
  let downloads = 0;
  let sourceReads = 0;
  page.on("download", () => downloads++);
  const task = {
    id: "editor-flow-task",
    status: "completed",
    sessionName: "验证团",
    format: "JSON",
    progress: 100,
    fileName: "验证团.json",
    filePath: "/exports/验证团.json",
    createdAt: "2026-11-19T20:00:00Z",
    peer: { chatType: 2, peerUid: "20001", peerUin: "20001", guildId: "" },
  };
  await page.addInitScript(() => {
    localStorage.setItem("qce_access_token", "mock-editor-token");
    localStorage.setItem("qce-onboarding-completed", "true");
  });
  await page.routeWebSocket("**", () => {});
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/auth", (route) =>
    route.fulfill({ json: { success: true, data: {} } }),
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method();
    if (url.pathname === "/api/download-file") {
      sourceReads++;
      expect(route.request().headers().authorization).toBe(
        "Bearer mock-editor-token",
      );
      return route.fulfill({ json: fixture });
    }
    let data: unknown = {};
    if (url.pathname === "/api/system/info")
      data = {
        name: "QCE",
        mode: "plugin",
        version: "6.4.3",
        napcat: {
          version: "mock",
          online: true,
          selfInfo: { uin: "", uid: "u_test", nick: "验证账号" },
        },
        runtime: { nodeVersion: "22", platform: "linux", uptime: 1 },
      };
    else if (url.pathname === "/api/security/ip-whitelist")
      data = {
        allowedIPs: ["127.0.0.1"],
        disabled: false,
        isDocker: false,
        currentClientIP: "127.0.0.1",
      };
    else if (url.pathname === "/api/groups")
      data = {
        groups: [{ groupCode: "20001", groupName: "验证团", memberCount: 3 }],
        totalCount: 1,
        hasNext: false,
      };
    else if (url.pathname === "/api/friends")
      data = { friends: [], totalCount: 0, hasNext: false };
    else if (url.pathname === "/api/recent-contacts") data = { contacts: [] };
    else if (url.pathname === "/api/tasks")
      data = { tasks: created ? [task] : [] };
    else if (url.pathname.endsWith("/export") && method === "POST") {
      exports++;
      const body = route.request().postDataJSON();
      expect(body.format).toBe("JSON");
      created = true;
      data = { ...task, taskId: task.id };
    }
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${BASE}/qce/sessions/`);
  await page.getByRole("button", { name: "整理", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "导出并整理", level: 1 }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "开始整理", exact: true }).click();
  const editor = page.frameLocator('iframe[title="跑团 log 整理"]');
  await expect(editor.locator("#rr-title")).toHaveText("验证团", {
    timeout: 15000,
  });
  await expect(editor.locator("#rr-progress")).toHaveText("已确认 0 / 4");
  await editor.locator("#rr-keep").click();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "跑团整理", exact: true }).click();
  await expect(editor.locator(".r-current")).toHaveAttribute(
    "data-message",
    "2",
  );
  expect(exports).toBe(1);
  expect(sourceReads).toBe(1);
  expect(downloads).toBe(0);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "展开侧栏", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await editor.locator("#trpg-review-flow").evaluate((element) => {
    element.requestFullscreen = () =>
      Promise.reject(new Error("fullscreen unavailable"));
  });
  await editor.locator("#rr-flow").click();
  await expect(page.locator('iframe[title="跑团 log 整理"]')).toHaveCSS(
    "position",
    "fixed",
  );
  await expect(editor.locator(".r-header")).toBeHidden();
  await editor.locator("#rr-flow").click();
  await expect(page.locator('iframe[title="跑团 log 整理"]')).toHaveCSS(
    "position",
    "static",
  );
  await editor.locator("#rr-file").setInputFiles({
    name: "其他.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...fixture, chatInfo: { name: "其他团" } }),
    ),
  });
  await expect(editor.locator("#rr-progress")).toHaveText("已确认 1 / 8");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "整理", exact: true }).click();
  await expect(editor.locator("#rr-title")).toHaveText("验证团");
  await expect(editor.locator("#rr-scope")).toHaveText("验证团");
  await expect(editor.locator("#rr-progress")).toHaveText("已确认 1 / 8");
  expect(sourceReads).toBe(2);
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "创建导出任务", level: 1 }),
  ).toBeVisible();
  for (const name of ["JSON", "HTML", "TXT", "EXCEL"])
    await expect(
      page.getByRole("dialog").getByRole("button", { name, exact: true }),
    ).toBeVisible();
});

async function portableProject(page: Page) {
  await page
    .locator("#rr-open-menu")
    .evaluate((element: HTMLDetailsElement) => {
      element.open = true;
    });
  const pending = page.waitForEvent("download");
  await page.locator("#rr-save-project").click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

test("active chapter follows review actions and cleaned messages can be drag assigned together", async ({
  page,
}) => {
  await importFixture(page);
  await page.locator("#rr-round").fill("第1章");
  await page.locator("#rr-use-section").check();
  await page.locator("#rr-keep").click();
  await page.keyboard.press("s");
  await page.keyboard.press("e");
  await page.locator("#rr-draft").fill("整理后的对话");
  await page.keyboard.press("Control+Enter");
  await page.locator("#rr-use-section").uncheck();
  await page.locator("#rr-keep").click();
  let packed = await portableProject(page);
  expect(packed.state.rounds).toEqual({ 0: "第1章", 1: "第1章", 2: "第1章" });
  expect(packed.state.decisions).toEqual(["keep", "exclude", "keep", "keep"]);
  await page.locator("#rr-open-menu > summary").click();
  await page.locator("#rr-draft-view").click();
  const first = await page.locator('[data-message="1"] .content').boundingBox();
  const last = await page.locator('[data-message="4"] .content').boundingBox();
  expect(first).toBeTruthy();
  expect(last).toBeTruthy();
  await page.mouse.move(first!.x + 8, first!.y + 8);
  await page.mouse.down();
  await page.mouse.move(last!.x + 8, last!.y + 12, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator("#rr-selection-count")).toHaveText("已选 3 条");
  await page.locator("#rr-round").fill("第2回合");
  await page.locator("#rr-round").press("Enter");
  await expect(page.locator("#rr-selection-count")).toHaveText("");
  packed = await portableProject(page);
  expect(packed.state.rounds).toEqual({
    0: "第2回合",
    1: "第1章",
    2: "第2回合",
    3: "第2回合",
  });
  expect(packed.state.decisions).toEqual(["keep", "exclude", "keep", "keep"]);
  expect(packed.state.useSection).toBe(false);
});

test("multiple chat windows share roles and keep reversible source settings across reload", async ({
  page,
}) => {
  await page.goto(EDITOR);
  const other = {
    ...fixture,
    chatInfo: { name: "私聊" },
    messages: fixture.messages.map((m) => ({
      ...m,
      time: m.time.replace("20:", "21:"),
    })),
  };
  await page.locator("#rr-file").setInputFiles([
    {
      name: "主群.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    },
    {
      name: "私聊.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(other)),
    },
  ]);
  await expect(page.locator("#rr-total")).toHaveText("8 条");
  await page.locator("#rr-sidebar > summary").click();
  await page.locator("#rr-roles-tab").click();
  await page
    .getByRole("textbox", { name: "角色名 10002", exact: true })
    .fill("林雾");
  await page
    .getByRole("textbox", { name: "角色名 10002", exact: true })
    .press("Tab");
  await page.locator("#rr-windows-tab").click();
  await page
    .getByRole("textbox", { name: "窗口名称 验证团", exact: true })
    .fill("主群");
  await page
    .getByRole("textbox", { name: "窗口名称 验证团", exact: true })
    .press("Tab");
  await page
    .getByRole("checkbox", { name: "纳入窗口 私聊", exact: true })
    .uncheck();
  await expect(page.locator("#rr-total")).toHaveText("4 条");
  await page.locator("#rr-keep").click();
  await page
    .getByRole("checkbox", { name: "纳入窗口 私聊", exact: true })
    .check();
  await expect(page.locator("#rr-progress")).toHaveText("已确认 1 / 8");
  await expect(page.locator("#rr-save")).toHaveText("已自动保存");
  await page.reload();
  await expect(page.locator("#rr-progress")).toHaveText("已确认 1 / 8");
  const packed = await portableProject(page);
  expect(packed.windows.map((w: { name: string }) => w.name)).toEqual([
    "主群",
    "私聊",
  ]);
  expect(packed.people).toHaveLength(2);
  expect(packed.people.find((p: { qq: string }) => p.qq === "10002").role).toBe(
    "林雾",
  );
  expect(packed.original).toEqual(fixture);
  expect(packed.windows[1].original).toEqual(other);
});

test("five thousand messages scroll with bounded DOM and an offscreen cursor cannot confirm unseen text", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(EDITOR);
  const data = {
    chatInfo: { name: "长篇验证" },
    messages: Array.from({ length: 5000 }, (_, i) => ({
      ...fixture.messages[i % 4],
      id: String(i),
      content: {
        text: `第${i + 1}条：${"这是需要逐条审阅的跑团正文。".repeat(i % 19 === 0 ? 30 : 1)}`,
      },
    })),
  };
  await page.locator("#rr-file").setInputFiles({
    name: "长篇.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator("#rr-total")).toHaveText("5000 条");
  expect(await page.locator(".message-block").count()).toBeLessThan(100);
  await page.locator(".r-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(page.locator(".r-current")).toHaveCount(0);
  const middle = await page
    .locator(".message-block")
    .first()
    .getAttribute("data-message");
  expect(Number(middle)).toBeGreaterThan(1000);
  await page.locator(".r-scroll").focus();
  await page.keyboard.press("a");
  await expect(page.locator('[data-message="1"]')).toBeInViewport();
  await expect(page.locator("#rr-progress")).toHaveText("已确认 0 / 5000");
  await page.locator("#rr-search").fill("#4000");
  await page.locator("#rr-search").press("Enter");
  await expect(page.locator('[data-message="4000"]')).toBeInViewport();
  await page.locator("#rr-keep").click();
  await expect(page.locator("#rr-progress")).toHaveText("已确认 1 / 5000");
  await expect(page.locator('[data-message="4001"]')).toBeInViewport();
  await page.locator(".r-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('[data-message="5000"]')).toBeInViewport();
  expect(await page.locator(".message-block").count()).toBeLessThan(100);
  expect(errors).toEqual([]);
});

test("compact collapsible managers and flow mode retain independent reading panes", async ({
  page,
}) => {
  await importFixture(page);
  await expect(page.locator("#rr-sidebar")).not.toHaveAttribute("open", "");
  await expect(page.locator("#rr-sections-panel")).not.toHaveAttribute(
    "open",
    "",
  );
  const searchBox = await page.locator("#rr-search").boundingBox();
  expect(searchBox!.width).toBeLessThanOrEqual(190);
  expect(searchBox!.height).toBeLessThan(32);
  await page.locator(".r-split-menu > summary").click();
  await page.locator("#rr-split-horizontal").click();
  await expect(page.locator(".r-pane")).toHaveCount(2);
  await page
    .locator(".r-pane select")
    .nth(1)
    .selectOption(JSON.stringify({ type: "person", personId: "qq:10002" }));
  await expect(
    page.locator(".r-pane").nth(1).locator(".message-block"),
  ).toHaveCount(2);
  await expect(
    page.locator(".r-pane").nth(0).locator(".message-block"),
  ).toHaveCount(4);
  await page.locator("#rr-flow").click();
  await expect(page.locator("#trpg-review-flow")).toHaveClass(/is-flow/);
  await expect(page.locator(".r-header")).toBeHidden();
  await expect(page.locator("#rr-sidebar")).toBeHidden();
  await expect(page.locator(".r-pane")).toHaveCount(2);
  await page.locator("#rr-flow").click();
  await expect(page.locator(".r-header")).toBeVisible();
  await page.locator("#rr-sidebar > summary").click();
  await expect(page.locator("#rr-windows")).toBeVisible();
  await page.locator("#rr-sidebar > summary").click();
  await expect(page.locator("#rr-windows")).toBeHidden();
});
