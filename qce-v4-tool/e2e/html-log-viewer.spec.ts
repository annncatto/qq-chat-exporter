import { expect, test } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test.use({ video: 'off', colorScheme: 'light' });

for (const inline of [true, false]) {
  test(`${inline ? 'single-file' : 'chunked'} HTML opens with native reading and Log review on one page`, async ({ page }) => {
    const dir = await mkdtemp(join(tmpdir(), 'qce-html-log-'));
    try {
      const source = join(__dirname, '../../qce-chunked-viewer/assets/modern_chunked_app.js');
      const rows = ['Open\nDoor', 'Second line', 'Third line'].map((text, i) => ({
        id: `msg-${i}`, ts: 1760000000000 + i * 1000, date: '2025-10-09', uid: 'uid-kp', uin: '10001',
        name: '主持人', nameLower: '主持人', text: text.toLowerCase(), logText: text,
        html: `<div class="message-block"><div class="message ${i === 1 ? 'self' : 'other'}" id="msg-${i}"><div class="avatar"><span>主</span></div><div class="message-wrapper"><div class="message-header"><span class="sender">主持人</span></div><div class="message-bubble"><div class="content">${text}</div></div></div></div></div>`,
      }));
      const data = [rows.slice(0, 2), rows.slice(2)];
      const chunks = data.map((messages, i) => ({
        id: String(i), file: `data/chunk-${i}.js`, count: messages.length, bytes: 1000,
        startTs: messages[0]!.ts, endTs: messages[messages.length - 1]!.ts, startDate: '2025-10-09', endDate: '2025-10-09',
        firstMsgId: messages[0]!.id, lastMsgId: messages[messages.length - 1]!.id, textBloom: '', senderBloom: '',
      }));
      const manifest = {
        format: 'qce-modern-html-chunked', version: 1, exportTime: '2026-11-20T10:00:00+09:00',
        chat: { name: '测试记录', type: 'group' }, stats: { totalMessages: rows.length, minDateKey: '2025-10-09', maxDateKey: '2025-10-09' },
        chunking: { maxMessagesPerChunk: 2 }, bloom: { textBits: 0, textHashes: 0, senderBits: 0, senderHashes: 0 },
        senders: [{ uid: 'uid-kp', displayName: '主持人', count: 3, avatar: 'https://q.qlogo.cn/g?b=qq&nk=10001&s=100' }],
        chunks,
      };
      const index = join(dir, 'index.html');
      if (inline) {
        const inlineData = { manifest, chunks: Object.fromEntries(data.map((messages, i) => [String(i), messages])), msgid: {} };
        const bundle = (await readFile(source, 'utf8')).replace(/<\/script/gi, '<\\/script');
        await writeFile(index, `<!doctype html><meta charset="utf-8"><div id="root"></div><script>window.__QCE_INLINE__=${JSON.stringify(inlineData)}</script><script>${bundle}</script>`);
      } else {
        await mkdir(join(dir, 'data'));
        await writeFile(join(dir, 'data', 'manifest.js'), `window.__QCE_MANIFEST__(${JSON.stringify(manifest)})`);
        for (const [i, messages] of data.entries())
          await writeFile(join(dir, 'data', `chunk-${i}.js`), `window.__QCE_CHUNK__(${JSON.stringify({ id: String(i), messages })})`);
        await copyFile(source, join(dir, 'app.js'));
        await writeFile(index, '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="app.js" defer></script>');
      }
      await page.route('https://**', route => route.abort());
      await page.goto(pathToFileURL(index).href);
      const viewport = page.locator('#viewport');
      await expect(viewport.locator('#msg-2')).toBeVisible();
      await expect(page.getByRole('button', { name: '搜索', exact: true })).toHaveCSS('background-color', 'rgb(39, 81, 211)');
      const bubbleColor = await viewport.locator('#msg-0 .message-bubble').evaluate(node => getComputedStyle(node).backgroundColor);
      await expect(viewport.locator('#msg-1 .message-bubble')).toHaveCSS('background-color', bubbleColor);
      await expect(page.getByPlaceholder('搜索消息')).toBeVisible();
      await page.getByPlaceholder('搜索消息').fill('second');
      await page.getByPlaceholder('搜索消息').press('Enter');
      await expect(viewport.locator('mark').first()).toHaveText('Second');
      await viewport.locator('#msg-0 .content').click();
      await page.getByRole('button', { name: '编辑 E', exact: true }).click();
      await expect(page.locator('#qce-log-edit-text')).toHaveValue('Open\nDoor');
      await page.locator('#qce-log-edit-text').fill('打开门。');
      await page.locator('#qce-log-edit-text').press('Control+Enter');
      await expect(viewport.locator('.qce-log-current')).toHaveAttribute('data-i', '1');
      const viewportBox = (await viewport.boundingBox())!;
      const nextBox = (await viewport.locator('#msg-1').boundingBox())!;
      expect(nextBox.y - viewportBox.y).toBeGreaterThan(32);
      await page.keyboard.press('a');
      await expect(viewport.locator('.qce-log-current')).toHaveAttribute('data-i', '2');
      await page.keyboard.press('s');
      await viewport.hover();
      await page.mouse.wheel(0, -800);
      await expect(viewport.locator('#msg-0 .content')).toBeInViewport();
      await viewport.locator('#msg-0 .content').click();
      await page.keyboard.press('e');
      await page.locator('#qce-log-edit-text').fill('门打开了。');
      await page.locator('#qce-log-edit-text').press('Control+Enter');
      await expect(viewport.locator('.qce-log-current')).toHaveAttribute('data-i', '1');

      await viewport.hover();
      await page.mouse.wheel(0, -800);
      await expect(viewport.locator('#msg-0 .content')).toBeInViewport();
      await expect(viewport.locator('#msg-1 .content')).toBeInViewport();
      for (const i of [0, 1]) {
        const kept = viewport.locator(`#msg-${i} .avatar + .qce-log-kept`);
        await expect(kept).toBeVisible();
        await expect(kept).toHaveText('✓');
        await expect(kept).toHaveAttribute('aria-label', '已保留');
      }
      await expect(viewport.locator('#msg-2 .qce-log-kept')).toHaveCount(0);
      const first = (await viewport.locator('#msg-0 .content').boundingBox())!;
      const second = (await viewport.locator('#msg-1 .content').boundingBox())!;
      await page.mouse.move(first.x + 6, first.y + 6);
      await page.mouse.down();
      await page.mouse.move(second.x + 6, second.y + 6, { steps: 8 });
      await page.mouse.up();
      await expect(page.getByText('已选 2 条')).toBeVisible();
      await page.getByRole('textbox', { name: '章节或回合' }).fill('第一回合');
      await page.getByRole('button', { name: '归入', exact: true }).click();
      await expect(viewport.locator('[data-i="0"]')).toContainText('第一回合');
      await expect(viewport.locator('[data-i="1"]')).toContainText('第一回合');
      await page.getByText('章节／回合', { exact: true }).click();
      await page.getByRole('button', { name: '第一回合', exact: true }).click();
      await expect(viewport.locator('.qce-log-current')).toHaveAttribute('data-i', '0');

      await page.getByText('角色管理', { exact: true }).click();
      await page.getByLabel('选择角色账号').selectOption('uid-kp');
      await page.getByRole('textbox', { name: '角色名', exact: true }).fill('KP');
      await page.getByRole('textbox', { name: '角色名', exact: true }).press('Enter');
      await expect(viewport.locator('#msg-0 .sender')).toHaveText('KP');
      await expect(viewport.locator('#msg-1 .sender')).toHaveText('KP');
      await page.getByText('整理进度', { exact: true }).click();
      const saved = page.waitForEvent('download');
      await page.getByRole('button', { name: '备份进度', exact: true }).click();
      const backup = (await (await saved).path())!;
      const project = JSON.parse(await readFile(backup, 'utf8'));
      expect(project.progress.decisions).toEqual({ 0: 'keep', 1: 'keep', 2: 'exclude' });
      expect(project.progress.chapters).toEqual({ 0: '第一回合', 1: '第一回合' });
      await page.getByRole('button', { name: '成稿', exact: true }).click();
      const draft = page.getByRole('complementary', { name: '成稿预览' });
      await expect(draft).toContainText('【KP】');
      await expect(draft).toContainText('门打开了。');
      await expect(draft).not.toContainText('Third line');
      const roundTitle = draft.getByRole('heading', { name: '第一回合', exact: true });
      const bodySize = await draft.locator('.qce-log-manuscript-line').first().evaluate(node => getComputedStyle(node).fontSize);
      await expect(roundTitle).toHaveCSS('text-align', 'center');
      await expect(roundTitle).toHaveCSS('font-weight', '700');
      await expect(roundTitle).toHaveCSS('font-size', bodySize);
      const htmlDownload = page.waitForEvent('download');
      await draft.getByRole('button', { name: 'HTML', exact: true }).click();
      const manuscriptPath = join(dir, 'manuscript.html');
      await (await htmlDownload).saveAs(manuscriptPath);
      const manuscript = await page.context().newPage();
      try {
        await manuscript.goto(pathToFileURL(manuscriptPath).href);
        const title = manuscript.getByRole('heading', { name: '第一回合', exact: true });
        const exportedBodySize = await manuscript.locator('article p').first().evaluate(node => getComputedStyle(node).fontSize);
        await expect(title).toHaveCSS('text-align', 'center');
        await expect(title).toHaveCSS('font-weight', '700');
        await expect(title).toHaveCSS('font-size', exportedBodySize);
      } finally {
        await manuscript.close();
      }
      const pending = page.waitForEvent('download');
      await draft.getByRole('button', { name: 'TXT', exact: true }).click();
      expect(await readFile((await (await pending).path())!, 'utf8')).toContain('【KP】\n门打开了。');
      await page.reload();
      await expect(page.getByText('已审 3 / 3')).toBeVisible();
      await expect(viewport.locator('[data-i="0"]')).toContainText('门打开了。');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.getByText('已审 0 / 3')).toBeVisible();
      await page.locator('input[aria-label="整理进度文件"]').setInputFiles(backup);
      await expect(page.getByText('已恢复整理进度。')).toBeVisible();
      await expect(page.getByText('已审 3 / 3')).toBeVisible();

      await page.getByText('记录管理', { exact: true }).click();
      const additional = {
        chatInfo: { name: '补充记录' },
        messages: [{ id: 'side-1', timestamp: 1760000000500, sender: { uid: 'uid-kp', uin: '10001', name: '另一个昵称' },
          content: { text: 'Before opening the door' } }],
      };
      await page.locator('input[aria-label="选择记录文件"]').setInputFiles({
        name: 'extra.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(additional)),
      });
      await expect(page.getByText('已导入 1 份记录。')).toBeVisible();
      await page.getByLabel('分屏布局').selectOption('horizontal');
      const compare = page.getByRole('region', { name: '对照窗' });
      await expect(compare.getByText('Before opening the door')).toBeVisible();
      await expect(compare.locator('.sender')).toHaveText('KP');
      await expect(viewport.getByText('Open', { exact: false }).first()).toBeVisible();
      await page.getByLabel('分屏布局').selectOption('vertical');
      expect((await compare.boundingBox())!.y).toBeGreaterThan((await viewport.boundingBox())!.y);
      await compare.getByText('Before opening the door').click();
      await expect(viewport.getByText('Before opening the door')).toBeVisible();
      await page.getByLabel('分屏布局').selectOption('single');
      await page.getByRole('button', { name: '保留 A', exact: true }).click();
      await page.getByRole('button', { name: '成稿', exact: true }).click();
      await expect(draft).toContainText('Before opening the door');
      await expect(draft).toContainText('门打开了。');
      const included = page.getByRole('checkbox', { name: '将 补充记录 纳入成稿' });
      await included.uncheck();
      await expect(draft).not.toContainText('Before opening the door');
      await included.check();
      await expect(draft).toContainText('Before opening the door');
      const handle = (await draft.getByRole('button', { name: '移动成稿' }).boundingBox())!;
      const original = (await draft.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x - 80, handle.y - 30, { steps: 8 });
      await page.mouse.up();
      expect((await draft.boundingBox())!.x).toBeLessThan(original.x - 40);
      const merged = page.waitForEvent('download');
      await draft.getByRole('button', { name: 'TXT', exact: true }).click();
      const mergedText = await readFile((await (await merged).path())!, 'utf8');
      expect(mergedText.indexOf('【KP】\nBefore opening the door')).toBeGreaterThanOrEqual(0);
      expect(mergedText.indexOf('门打开了。')).toBeLessThan(mergedText.indexOf('Before opening the door'));
      expect(mergedText.indexOf('Before opening the door')).toBeLessThan(mergedText.indexOf('Second line'));

      await draft.getByRole('button', { name: '连成一段', exact: true }).click();
      await draft.getByRole('button', { name: '门打开了。', exact: true }).click();
      await expect(draft.getByRole('button', { name: 'Before opening the door', exact: true })).toBeDisabled();
      await draft.getByRole('button', { name: 'Second line', exact: true }).click();
      await draft.getByRole('button', { name: '确认连段', exact: true }).click();
      await expect(draft.getByRole('button', { name: '拆开此段', exact: true })).toBeVisible();
      const grouped = page.waitForEvent('download');
      await draft.getByRole('button', { name: 'TXT', exact: true }).click();
      const groupedText = await readFile((await (await grouped).path())!, 'utf8');
      expect(groupedText.indexOf('门打开了。')).toBeLessThan(groupedText.indexOf('Second line'));
      expect(groupedText.indexOf('Second line')).toBeLessThan(groupedText.indexOf('Before opening the door'));
      await page.reload();
      await page.getByRole('button', { name: '成稿', exact: true }).click();
      await expect(draft.getByRole('button', { name: '拆开此段', exact: true })).toBeVisible();
      await draft.getByRole('button', { name: '拆开此段', exact: true }).click();
      await expect(draft.getByRole('button', { name: '拆开此段', exact: true })).toHaveCount(0);
      await expect(draft.locator('article .qce-log-manuscript-line')).toHaveText([
        '门打开了。', 'Before opening the door', 'Second line',
      ]);
      await draft.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByText('记录管理', { exact: true }).click();
      await expect(page.getByRole('button', { name: '补充记录', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '补充记录', exact: true }).click();
      await expect(viewport.getByText('Before opening the door')).toBeVisible();
      await expect(page.getByText('已审 1 / 1')).toBeVisible();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
