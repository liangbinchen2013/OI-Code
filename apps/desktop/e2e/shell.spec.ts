import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

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

    await page.locator('.oi-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
  } finally {
    await app.close();
  }
});
