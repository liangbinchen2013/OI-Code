import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, mockOpenFileDialog } from './helpers';

test('不保留原生应用菜单栏', async () => {
  const app = await launchApp();
  try {
    const hasMenu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null);
    expect(hasMenu).toBe(false);
  } finally {
    await app.close();
  }
});

test('主题切换生效并在刷新后保持', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    const before = await page.locator('html').getAttribute('data-theme');
    const expected = before === 'dark' ? 'light' : 'dark';

    await page.locator('.oi-activity-item-settings').click();
    await expect(page.locator('.oi-settings')).toBeVisible();
    await page.locator('.oi-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
  } finally {
    await app.close();
  }
});

test('打开文件夹后侧边栏显示目录树并可打开文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-tree-'));
  await writeFile(join(directory, 'a.cpp'), 'int main() { return 0; }\n', 'utf8');
  await mkdir(join(directory, 'sub'));
  await writeFile(join(directory, 'sub', 'b.py'), 'print(1)\n', 'utf8');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    await mockOpenFileDialog(app, directory);
    await page.locator('.oi-sidebar').getByRole('button', { name: '打开文件夹' }).click();

    await expect(page.locator('.oi-tree')).toContainText('a.cpp');
    await expect(page.locator('.oi-tree')).toContainText('sub');

    await page.locator('.oi-tree-row', { hasText: 'sub' }).first().click();
    await expect(page.locator('.oi-tree')).toContainText('b.py');

    await page.locator('.oi-tree-row', { hasText: 'b.py' }).click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('b.py');
    await expect(page.locator('.view-lines')).toContainText('print(1)');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
