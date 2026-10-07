import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers';

/** 与 libs/workbench/src/browser/environmentBootstrap.ts 的标记键保持一致。 */
const BOOTSTRAP_DONE_KEY = 'oi-code.environment-bootstrap.done';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

async function readBootstrapFlag(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), BOOTSTRAP_DONE_KEY);
}

test('首次启动自动搜索工具链：检出即提示，缺失则给出下载指引', async () => {
  test.setTimeout(240_000);
  const userDataDir = await mkdtemp(join(tmpdir(), 'oi-code-env-userdata-'));
  const app = await launchApp({ userDataDir, env: { OI_SKIP_ENV_BOOTSTRAP: '0' } });
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    // 自检完成才会写标记；耗时取决于本机需要搜索与探测的工具链数量
    await expect.poll(() => readBootstrapFlag(page), { timeout: 180_000 }).toBe('true');

    const dialog = page.locator('.oi-env-dialog');
    if ((await dialog.count()) > 0) {
      // 存在未检出的工具链：必须给出可点击的官方下载地址，且可关闭
      expect(await dialog.locator('.oi-env-links a').count()).toBeGreaterThan(0);
      await dialog.locator('.oi-env-finish').click();
      await expect(dialog).toHaveCount(0);
    } else {
      // 全部检出：右下角胶囊提示已自动配置，且不打扰用户
      await expect(page.locator('.oi-status-capsule')).toContainText('环境已自动配置');
    }
  } finally {
    await app.close();
    await rm(userDataDir, { maxRetries: 5, recursive: true, force: true });
  }
});

test('二次启动不再重复自检', async () => {
  test.setTimeout(240_000);
  const userDataDir = await mkdtemp(join(tmpdir(), 'oi-code-env-userdata-'));
  try {
    const first = await launchApp({ userDataDir, env: { OI_SKIP_ENV_BOOTSTRAP: '0' } });
    try {
      const firstPage = await first.firstWindow();
      await waitReady(firstPage);
      await expect.poll(() => readBootstrapFlag(firstPage), { timeout: 180_000 }).toBe('true');
    } finally {
      await first.close();
    }

    const second = await launchApp({ userDataDir, env: { OI_SKIP_ENV_BOOTSTRAP: '0' } });
    try {
      const page = await second.firstWindow();
      await waitReady(page);
      // 标记已存在：自检整体跳过，无进度胶囊、无引导弹窗、无结果提示
      await page.waitForTimeout(2000);
      await expect(page.locator('.oi-env-progress')).toHaveCount(0);
      await expect(page.locator('.oi-env-dialog')).toHaveCount(0);
      await expect(page.locator('.oi-status-capsule')).toHaveCount(0);
    } finally {
      await second.close();
    }
  } finally {
    await rm(userDataDir, { maxRetries: 5, recursive: true, force: true });
  }
});
