import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

async function openVjudge(page: Page): Promise<void> {
  await page.locator('.oi-activity-item[aria-label="VJudge"]').click();
  await expect(page.locator('.oi-vjudge')).toBeVisible();
}

test('VJudge 视图：控件齐备且未取题时不可提交', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openVjudge(page);

    await expect(page.locator('.oi-vjudge-account')).toContainText('VJudge');
    await expect(page.locator('.oi-vjudge-field input').first()).toBeVisible();
    await expect(page.locator('.oi-vjudge-field-prob input')).toBeVisible();
    await expect(page.locator('.oi-vjudge-fetch')).toBeVisible();
    // 未拉取题面前提交按钮禁用，语言下拉给出占位说明
    await expect(page.locator('.oi-vjudge-submit')).toBeDisabled();
    await expect(page.locator('.oi-vjudge-field-lang option').first()).toContainText(
      '请先拉取题面',
    );
    await expect(page.locator('.oi-vjudge-statement')).toContainText('输入 OJ 与题号');

    // 切回资源管理器时视图隐藏但不销毁
    await page.locator('.oi-activity-item[aria-label="资源管理器"]').click();
    await expect(page.locator('.oi-vjudge')).toBeHidden();
    await openVjudge(page);
    await expect(page.locator('.oi-vjudge')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('VJudge 登录窗口：展开挂载同分区 webview，可再次收起', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openVjudge(page);

    await page.locator('.oi-vjudge-login-btn').click();
    const webview = page.locator('.oi-vjudge-login-stage webview');
    await expect(webview).toBeAttached();
    expect(await webview.getAttribute('partition')).toBe('persist:oi-code-browser');

    await page.locator('.oi-vjudge-login-close').click();
    await expect(page.locator('.oi-vjudge-login')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('VJudge 设置：提交前预检开关持久化', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();

    const section = page.locator('.oi-settings-section', { hasText: 'VJudge 远程评测' });
    await expect(section).toBeVisible();
    const toggle = section.locator('input[type=checkbox]');
    // 默认开启
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await page.reload();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();
    await expect(
      page
        .locator('.oi-settings-section', { hasText: 'VJudge 远程评测' })
        .locator('input[type=checkbox]'),
    ).not.toBeChecked();
  } finally {
    await app.close();
  }
});

test('VJudge 取题失败时给出可见提示而非静默', async () => {
  test.setTimeout(180_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openVjudge(page);

    await page.locator('.oi-vjudge-field input').first().fill('POJ');
    await page.locator('.oi-vjudge-field-prob input').fill('1000');
    await page.locator('.oi-vjudge-fetch').click();

    // 未登录或网络不可达都会以提示条呈现，不允许无反馈失败
    const message = page.locator('.oi-vjudge-message');
    await expect(message).toBeVisible({ timeout: 60_000 });
    expect((await message.innerText()).trim().length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
