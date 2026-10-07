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
