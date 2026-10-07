import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

test('OI 工具箱内置浏览器：webview 挂载、地址栏导航与主题持久化', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
    await page.locator('.oi-tool-browser').click();

    await expect(page.locator('.oi-browser')).toBeVisible();
    await expect(page.locator('.oi-browser-stage webview')).toBeAttached();

    // 地址栏导航
    await page.locator('.oi-browser-address').fill('about:blank');
    await page.locator('.oi-browser-go').click();
    await expect(page.locator('.oi-browser-address')).toHaveValue('about:blank', {
      timeout: 15_000,
    });

    // 切换工具后返回，浏览器保持挂载（不重载页面）
    await page.locator('.oi-toolbox-back').click();
    await expect(page.locator('.oi-tool-browser')).toBeVisible();
    await expect(page.locator('.oi-browser')).toBeHidden();
    await page.locator('.oi-tool-browser').click();
    await expect(page.locator('.oi-browser-address')).toHaveValue('about:blank');

    // 主题选择持久化：刷新后仍为暗色
    await page.locator('.oi-browser-theme').selectOption('dark');
    await page.reload();
    await waitReady(page);
    await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
    await page.locator('.oi-tool-browser').click();
    await expect(page.locator('.oi-browser-theme')).toHaveValue('dark');
    await expect(page.locator('.oi-browser-stage webview')).toBeAttached();
  } finally {
    await app.close();
  }
});
