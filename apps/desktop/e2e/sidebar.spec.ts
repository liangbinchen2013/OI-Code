import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('活动栏切换资源管理器与 OI 工具箱，正计时运行并可暂停重置', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(page.locator('.oi-explorer')).toBeVisible();

    await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
    await expect(page.locator('.oi-toolbox')).toBeVisible();
    await expect(page.locator('.oi-explorer')).toBeHidden();

    await page.locator('.oi-tool-timer').click();
    const display = page.locator('.oi-timer-display');
    await expect(display).toHaveText('00:00.0');

    await page.locator('.oi-timer-toggle').click();
    const first = await display.textContent();
    await expect.poll(async () => display.textContent(), { timeout: 5000 }).not.toBe(first);

    await page.locator('.oi-timer-toggle').click();
    await page.locator('.oi-timer-reset').click();
    await expect(display).toHaveText('00:00.0');

    await page.locator('.oi-toolbox-back').click();
    await expect(page.locator('.oi-tool-timer')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('计时器倒计时归零提示时间到', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
    await page.locator('.oi-tool-timer').click();

    await page.locator('.oi-timer-countdown').click();
    await page.locator('.oi-timer-seconds').fill('2');
    await page.locator('.oi-timer-toggle').click();

    await expect(page.locator('.oi-timer-display')).toHaveClass(/oi-timer-display-finished/, {
      timeout: 10_000,
    });
    await expect(page.locator('.oi-timer-finished-text')).toHaveText('时间到');

    await page.locator('.oi-timer-reset').click();
    await expect(page.locator('.oi-timer-display')).toHaveText('00:02.0');
  } finally {
    await app.close();
  }
});

test('侧边栏可拖拽调整宽度并持久化', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    const sidebar = page.locator('.oi-sidebar');
    const before = await sidebar.boundingBox();
    const handle = page.locator('.oi-resize-handle');
    const box = await handle.boundingBox();
    expect(before).not.toBeNull();
    expect(box).not.toBeNull();
    if (before === null || box === null) {
      return;
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const after = await sidebar.boundingBox();
    expect(after).not.toBeNull();
    if (after === null) {
      return;
    }
    expect(after.width).toBeGreaterThan(before.width + 80);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    const reloaded = await page.locator('.oi-sidebar').boundingBox();
    expect(reloaded).not.toBeNull();
    if (reloaded === null) {
      return;
    }
    expect(Math.abs(reloaded.width - after.width)).toBeLessThanOrEqual(4);
  } finally {
    await app.close();
  }
});

test('设置中新增自定义模板后可经 + 菜单新建', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    await page.locator('.oi-activity-item-settings').click();
    await page.locator('.oi-template-add').click();
    await page.locator('.oi-template-name-input').fill('我的模板');
    await page.locator('.oi-template-ext-input').fill('py');
    await page.locator('.oi-template-content').fill('print("hello template")');
    await page.locator('.oi-template-save').click();
    await expect(page.locator('.oi-template-row')).toContainText('我的模板');

    await page.locator('.oi-tab-new').click();
    await page.locator('.oi-menu-item', { hasText: '我的模板' }).click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('未命名-1.py');
    await expect(page.locator('.view-lines')).toContainText('hello template');
  } finally {
    await app.close();
  }
});
