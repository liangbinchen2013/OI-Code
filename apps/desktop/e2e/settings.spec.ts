import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockOpenFileDialog } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

test('设置中可调编辑器字号与制表符宽度并持久化', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-settings-'));
  const sourcePath = join(directory, 'style.cpp');
  await writeFile(sourcePath, 'int main() { return 0; }\n', 'utf8');

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await mockOpenFileDialog(app, sourcePath);
    await page
      .locator('.oi-empty-state')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('style.cpp');

    await page.locator('.oi-activity-item-settings').click();
    await page.locator('#oi-editor-font-size').fill('20');
    await expect(page.locator('.view-lines').first()).toHaveCSS('font-size', '20px');

    await page.locator('#oi-editor-tab-size').selectOption('8');
    await expect(page.locator('#oi-editor-tab-size')).toHaveValue('8');

    // 刷新后设置保持
    await page.reload();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();
    await expect(page.locator('#oi-editor-font-size')).toHaveValue('20');
    await expect(page.locator('#oi-editor-tab-size')).toHaveValue('8');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('内置模板可编辑、隐藏并通过恢复按钮还原', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();

    // 编辑内置 C++ 模板
    await page
      .locator('.oi-template-row', { hasText: 'C++ 文件' })
      .locator('.oi-template-edit')
      .click();
    await page.locator('.oi-template-name-input').fill('我的 C++');
    const contentEditor = page.locator('.oi-template-content-editor .monaco-editor');
    await contentEditor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('// custom template');
    await page.locator('.oi-template-save').click();
    await expect(page.locator('.oi-template-row', { hasText: '我的 C++' })).toBeVisible();

    // + 菜单使用覆盖后的模板
    await page.locator('.oi-tab-new').click();
    await page.locator('.oi-menu-item', { hasText: '我的 C++' }).click();
    await expect(page.locator('.view-lines').first()).toContainText('custom template');

    // 隐藏内置 Python 模板（设置面板仍处于活动视图）
    await page
      .locator('.oi-template-row', { hasText: 'Python 文件' })
      .locator('.oi-template-delete')
      .click();
    await expect(page.locator('.oi-template-row', { hasText: 'Python 文件' })).toHaveCount(0);
    await page.locator('.oi-tab-new').click();
    await expect(page.locator('.oi-menu-item', { hasText: 'Python 文件' })).toHaveCount(0);
    await page.locator('.oi-menu-backdrop').click();

    // 恢复内置模板
    await page.locator('.oi-template-reset').click();
    await expect(page.locator('.oi-template-row', { hasText: 'C++ 文件' })).toBeVisible();
    await expect(page.locator('.oi-template-row', { hasText: 'Python 文件' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('模板内容使用 Monaco 编辑器且 Tab 正常缩进', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();
    await page.locator('.oi-template-add').click();

    const templateEditor = page.locator('.oi-template-content-editor .monaco-editor');
    await expect(templateEditor).toBeVisible();

    await templateEditor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('int main() {');
    await page.keyboard.press('Tab');
    await page.keyboard.type('return 0;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('}');

    // Tab 插入缩进而不是移走焦点
    const focusedInside = await page.evaluate(
      () => document.activeElement?.closest('.oi-template-content-editor') !== null,
    );
    expect(focusedInside).toBe(true);

    await page.locator('.oi-template-save').click();
    const stored = await page.evaluate(() => window.localStorage.getItem('oi-code.templates'));
    expect(stored).toContain('int main() {');
    expect(stored).toContain('    return 0;');
  } finally {
    await app.close();
  }
});
