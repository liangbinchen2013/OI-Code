import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const specDir = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(specDir, '../../../dist/desktop/main.cjs');

test('启动空窗口并完成 JSON-RPC 握手', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  try {
    const window = await app.firstWindow();
    await expect(window.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(window.locator('.oi-workbench')).toBeAttached();
  } finally {
    await app.close();
  }
});
