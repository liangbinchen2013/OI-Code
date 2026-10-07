import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, mockCloseDialog, mockOpenFileDialog } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

/** 强杀整个进程树（模拟崩溃/断电），确保不触发正常退出的草稿清理。 */
async function forceKill(app: ElectronApplication): Promise<void> {
  const child = app.process();
  if (child.pid === undefined) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 进程已退出
    }
  } else {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      // 进程已退出
    }
  }
  await exited;
}

test('自动保存的草稿在进程强杀后重启可恢复，正常退出则清理', async () => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-autosave-e2e-'));
  const filePath = join(directory, 'draft.cpp');
  await writeFile(filePath, 'int main() { return 0; }\n', 'utf8');
  const userDataDir = await mkdtemp(join(tmpdir(), 'oi-code-autosave-userdata-'));
  const autoSaveDir = join(userDataDir, 'autosave');

  const first = await launchApp({ userDataDir });
  let killed = false;
  try {
    const page = await first.firstWindow();
    await waitReady(page);
    await mockOpenFileDialog(first, filePath);
    await page
      .locator('.oi-empty-state')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('draft.cpp');

    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// crashed draft');
    await expect(page.locator('.oi-tab-active .oi-dirty-dot')).toBeAttached();

    // 等 10 秒自动保存周期把草稿写入临时目录
    await expect
      .poll(
        async () => {
          try {
            const entries = await readdir(autoSaveDir);
            return entries.filter((entry) => entry.endsWith('.oi-autosave')).length;
          } catch {
            return 0;
          }
        },
        { timeout: 40_000 },
      )
      .toBeGreaterThan(0);

    // 强杀进程：跳过正常退出的草稿清理，模拟崩溃/断电
    await forceKill(first);
    killed = true;
  } finally {
    if (!killed) {
      await first.close().catch(() => undefined);
    }
  }

  const second = await launchApp({ userDataDir });
  try {
    const page = await second.firstWindow();
    await waitReady(page);
    await expect(page.locator('.oi-recover-dialog')).toBeVisible();
    await expect(page.locator('.oi-recover-list')).toContainText('draft.cpp');

    await page.locator('.oi-recover-confirm').click();
    await expect(page.locator('.oi-recover-dialog')).toHaveCount(0);
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('draft.cpp');
    await expect(page.locator('.view-lines')).toContainText('crashed draft');
    await expect(page.locator('.oi-tab-active .oi-dirty-dot')).toBeAttached();

    // 正常退出应清理全部草稿（恢复后的文档仍为脏，关闭时自动确认放弃）
    await mockCloseDialog(second, 0);
    await second.close();
    const remaining = (await readdir(autoSaveDir).catch(() => [])).filter((entry) =>
      entry.endsWith('.oi-autosave'),
    );
    expect(remaining).toEqual([]);

    const disk = await readFile(filePath, 'utf8');
    expect(disk).not.toContain('crashed draft');
  } finally {
    await second.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});
