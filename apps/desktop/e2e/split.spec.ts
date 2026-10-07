import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockOpenFileDialog } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

/** 首个文件从空态打开，之后经设置页打开。 */
async function openFile(
  app: Awaited<ReturnType<typeof launchApp>>,
  page: Page,
  filePath: string,
): Promise<void> {
  await mockOpenFileDialog(app, filePath);
  const emptyButton = page
    .locator('.oi-empty-state')
    .getByRole('button', { name: '打开文件', exact: true });
  if ((await emptyButton.count()) > 0) {
    await emptyButton.click();
  } else {
    await page.locator('.oi-activity-item-settings').click();
    await page
      .locator('.oi-settings')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
  }
  await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText(basename(filePath));
}

test('分屏预览：Markdown 实时渲染、拖拽比例、方向切换与持久化', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-split-'));
  const markdownPath = join(directory, 'solution.md');
  await writeFile(
    markdownPath,
    [
      '# 题解',
      '',
      '**核心**思路',
      '',
      '| 复杂度 | 值 |',
      '| --- | --- |',
      '| 时间 | O(n) |',
      '',
      '```cpp',
      'int main() { return 0; }',
      '```',
      '',
    ].join('\n'),
    'utf8',
  );

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

    // 表格与代码块高亮（Monaco 词法着色）
    await expect(page.locator('.oi-preview-markdown table th').first()).toHaveText('复杂度');
    await expect(page.locator('.oi-preview-markdown table td', { hasText: 'O(n)' })).toBeVisible();
    await expect(
      page.locator('.oi-preview-markdown pre.oi-md-code span[class*="mtk"]').first(),
    ).toBeAttached();

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

test('分屏焦点感知：点击文件在焦点侧打开，重复点击另一屏则交换', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-split-focus-'));
  const firstPath = join(directory, 'a.cpp');
  const secondPath = join(directory, 'b.cpp');
  const thirdPath = join(directory, 'c.cpp');
  await writeFile(firstPath, 'int main() { return 0; }\n', 'utf8');
  await writeFile(secondPath, 'int main() { return 0; }\n', 'utf8');
  await writeFile(thirdPath, 'int main() { return 0; }\n', 'utf8');

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, firstPath); // 左屏 a
    await openFile(app, page, secondPath); // 左屏 b，右屏待定

    await page.locator('.oi-split-toggle').click();
    const secondary = page.locator('.oi-split-secondary .monaco-editor');
    await expect(secondary).toBeVisible();
    await expect(secondary).toHaveAttribute('data-uri', /a\.cpp$/);

    // 焦点在右屏：点击左屏文件 b → 两屏交换
    await secondary.click();
    await page.locator('.oi-tab', { hasText: 'b.cpp' }).locator('.oi-tab-label').click();
    await expect(secondary).toHaveAttribute('data-uri', /b\.cpp$/);

    // 焦点仍在右屏：经 Ctrl+O 打开新文件 c → 右屏切换为 c
    await mockOpenFileDialog(app, thirdPath);
    await page.keyboard.press('Control+o');
    await expect(secondary).toHaveAttribute('data-uri', /c\.cpp$/);
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('c.cpp');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('两个代码标签分屏为双编辑器，保存随焦点定位文档', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-split-code-'));
  const firstPath = join(directory, 'a.cpp');
  const secondPath = join(directory, 'b.cpp');
  await writeFile(firstPath, 'int main() { return 0; }\n', 'utf8');
  await writeFile(secondPath, 'int main() { return 0; }\n', 'utf8');

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, firstPath);
    await openFile(app, page, secondPath);

    // 开启分屏：副编辑器显示上一个标签 a.cpp
    await page.locator('.oi-split-toggle').click();
    const secondary = page.locator('.oi-split-secondary .monaco-editor');
    await expect(secondary).toBeVisible();

    // 在副编辑器输入：a.cpp 标签变脏
    await secondary.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n// edited in secondary');
    await expect(
      page.locator('.oi-tab', { hasText: 'a.cpp' }).locator('.oi-dirty-dot'),
    ).toBeAttached();

    // Ctrl+S 保存焦点所在编辑器（a.cpp），b.cpp 不受影响
    await page.keyboard.press('Control+s');
    await expect(page.locator('.oi-status-capsule')).toContainText('已保存');
    expect(await readFile(firstPath, 'utf8')).toContain('edited in secondary');
    expect(await readFile(secondPath, 'utf8')).not.toContain('edited in secondary');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
