import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockOpenFileDialog } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

test('分屏预览：Markdown 实时渲染、拖拽比例、方向切换与持久化', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-split-'));
  const markdownPath = join(directory, 'solution.md');
  await writeFile(markdownPath, '# 题解\n\n**核心**思路\n', 'utf8');

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await mockOpenFileDialog(app, markdownPath);
    await page
      .locator('.oi-empty-state')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('solution.md');

    // 开启左右分屏并渲染 Markdown
    await page.locator('.oi-split-toggle').click();
    await expect(page.locator('.oi-split-horizontal')).toBeAttached();
    await expect(page.locator('.oi-split-secondary')).toBeVisible();
    await expect(page.locator('.oi-preview-markdown h1')).toHaveText('题解');

    // 编辑内容实时反映到预览
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n实时更新');
    await expect(page.locator('.oi-preview-markdown')).toContainText('实时更新');

    // 拖拽分割手柄调节比例
    const primary = page.locator('.oi-split-primary');
    const before = await primary.boundingBox();
    const handle = page.locator('.oi-split-handle');
    const handleBox = await handle.boundingBox();
    expect(before).not.toBeNull();
    expect(handleBox).not.toBeNull();
    if (before !== null && handleBox !== null) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x - 120, handleBox.y + handleBox.height / 2, { steps: 8 });
      await page.mouse.up();
      const after = await primary.boundingBox();
      expect(after).not.toBeNull();
      if (after !== null) {
        expect(after.width).toBeLessThan(before.width - 40);
      }
    }

    // 切换为上下分屏
    await page.locator('.oi-split-toggle').click();
    await expect(page.locator('.oi-split-vertical')).toBeAttached();
    await expect(page.locator('.oi-preview')).toBeVisible();

    // 再点一次关闭分屏
    await page.locator('.oi-split-toggle').click();
    await expect(page.locator('.oi-split-secondary')).toHaveCount(0);

    // 开启后刷新：分屏状态持久化，重新打开文件即恢复预览
    await page.locator('.oi-split-toggle').click();
    await page.reload();
    await waitReady(page);
    await mockOpenFileDialog(app, markdownPath);
    await page
      .locator('.oi-empty-state')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
    await expect(page.locator('.oi-split-secondary')).toBeVisible();
    await expect(page.locator('.oi-preview-markdown h1')).toHaveText('题解');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
