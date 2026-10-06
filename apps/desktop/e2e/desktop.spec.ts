import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('启动空窗口并完成 JSON-RPC 握手', async () => {
  const app = await launchApp();
  try {
    const window = await app.firstWindow();
    await expect(window.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(window.locator('.oi-workbench')).toBeAttached();
  } finally {
    await app.close();
  }
});
