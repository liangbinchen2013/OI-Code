import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('应用菜单为中文且包含常用项', async () => {
  const app = await launchApp();
  try {
    const labels = await app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? [],
    );
    expect(labels).toEqual(['文件', '编辑', '视图', '窗口']);

    const fileItems = await app.evaluate(
      ({ Menu }) =>
        Menu.getApplicationMenu()
          ?.items.find((item) => item.label === '文件')
          ?.submenu?.items.map((item) => item.label) ?? [],
    );
    expect(fileItems).toContain('打开文件…');
    expect(fileItems).toContain('保存');

    const viewItems = await app.evaluate(
      ({ Menu }) =>
        Menu.getApplicationMenu()
          ?.items.find((item) => item.label === '视图')
          ?.submenu?.items.map((item) => item.label) ?? [],
    );
    expect(viewItems).toContain('切换主题');
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

    await page.locator('.oi-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
  } finally {
    await app.close();
  }
});
