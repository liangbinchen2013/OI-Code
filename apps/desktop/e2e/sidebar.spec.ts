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

test('侧边栏拖拽至最小宽度自动折叠，点击图标展开后保持并再次点击收起', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    const sidebar = page.locator('.oi-sidebar');
    const handle = page.locator('.oi-resize-handle');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) {
      return;
    }

    // 向左拖过折叠阈值：吸附到 48px 仅剩活动栏
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(sidebar).toHaveClass(/collapsed/);
    await expect(page.locator('.oi-sidebar-panels')).toBeHidden();
    const collapsed = await sidebar.boundingBox();
    expect(collapsed?.width).toBeLessThanOrEqual(52);

    // 折叠态点击活动栏图标：展开面板
    const toolboxItem = page.locator('.oi-activity-item[aria-label="OI 工具箱"]');
    await toolboxItem.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
    await expect(page.locator('.oi-toolbox')).toBeVisible();

    // 鼠标移出侧边栏不再强制缩回
    await page.mouse.move(900, 400);
    await expect(sidebar).not.toHaveClass(/collapsed/);
    await expect(page.locator('.oi-toolbox')).toBeVisible();

    // 再次点击当前活动的图标：快速折叠
    await toolboxItem.click();
    await expect(sidebar).toHaveClass(/collapsed/);
    await expect(page.locator('.oi-sidebar-panels')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('侧边栏 200px 时设置面板垂直堆叠且按钮不丢失', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await page.locator('.oi-activity-item-settings').click();
    await expect(page.locator('.oi-settings')).toBeVisible();

    const sidebar = page.locator('.oi-sidebar');
    const handle = page.locator('.oi-resize-handle');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) {
      return;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(sidebarBox?.width).toBeLessThan(260);

    // 设置行改为垂直堆叠：输入框占满可用宽度且完整落在侧边栏内
    const templateAdd = page.locator('.oi-template-add');
    await expect(templateAdd).toBeVisible();
    const templateBox = await templateAdd.boundingBox();
    expect(templateBox).not.toBeNull();
    if (templateBox !== null && sidebarBox !== null) {
      expect(templateBox.x + templateBox.width).toBeLessThanOrEqual(
        sidebarBox.x + sidebarBox.width + 1,
      );
    }

    await templateAdd.click();
    const nameInput = page.locator('.oi-template-name-input');
    await expect(nameInput).toBeVisible();
    const inputBox = await nameInput.boundingBox();
    expect(inputBox).not.toBeNull();
    if (inputBox !== null && sidebarBox !== null) {
      expect(inputBox.width).toBeGreaterThan(120);
      expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width + 1);
    }
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
    const contentEditor = page.locator('.oi-template-content-editor .monaco-editor');
    await contentEditor.click();
    await page.keyboard.type('print("hello template")');
    await page.locator('.oi-template-save').click();
    await expect(page.locator('.oi-template-row', { hasText: '我的模板' })).toBeVisible();

    await page.locator('.oi-tab-new').click();
    await page.locator('.oi-menu-item', { hasText: '我的模板' }).click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('未命名-1.py');
    await expect(page.locator('.view-lines')).toContainText('hello template');
  } finally {
    await app.close();
  }
});
