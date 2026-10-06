import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchApp, mockCloseDialog, mockOpenFileDialog } from './helpers';

/**
 * 以原生窗口路径发起关闭（等价用户点击关闭按钮）；
 * 渲染进程的 window.close() 会绕过可取消的 close 事件，不用于本用例。
 */
async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
}

const C_SOURCE = '#include <iostream>\n\nint main() {\n  std::cout << "hi";\n  return 0;\n}\n';
const CURSOR_TO_END = 'Control+End';

async function createFixture(
  name: string,
  content: string,
): Promise<{ directory: string; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-e2e-'));
  const filePath = join(directory, name);
  await writeFile(filePath, content, 'utf8');
  return { directory, filePath };
}

test('打开 C++ 文件、高亮、编辑并保存', async () => {
  const { directory, filePath } = await createFixture('hello.cpp', C_SOURCE);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
    await expect(page.locator('.oi-empty-state')).toBeVisible();

    await mockOpenFileDialog(app, filePath);
    await page.locator('.oi-topbar').getByRole('button', { name: '打开文件' }).click();

    await expect(page.locator('.oi-doc-name')).toHaveText('hello.cpp');
    await expect(page.locator('.view-lines')).toContainText('iostream');
    await expect(page.locator('.view-line span[class*="mtk"]').first()).toBeAttached();

    const editor = page.locator('.monaco-editor');
    await editor.click();
    await page.keyboard.press(CURSOR_TO_END);
    await page.keyboard.type('// edited by e2e');
    await expect(page.locator('.oi-dirty-dot')).toBeAttached();

    await page.keyboard.press('Control+s');
    await expect(page.locator('.oi-status-capsule')).toContainText('已保存');
    await expect(page.locator('.oi-dirty-dot')).toHaveCount(0);

    const saved = await readFile(filePath, 'utf8');
    expect(saved).toContain('// edited by e2e');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('未经对话框授权的路径读写被拒绝', async () => {
  const { directory, filePath } = await createFixture('secret.txt', 'top-secret');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    const response = await page.evaluate((target) => {
      return new Promise<{ error?: { code: number; message: string } }>((resolve) => {
        const preload = window.oiCode;
        if (!preload) {
          throw new Error('preload 未注入');
        }
        const off = preload.ipc.onMessage((message) => {
          if (typeof message !== 'object' || message === null) {
            return;
          }
          const candidate = message as { id?: unknown; error?: unknown };
          if (candidate.id !== 424242) {
            return;
          }
          off();
          resolve(candidate as { error?: { code: number; message: string } });
        });
        preload.ipc.send({
          jsonrpc: '2.0',
          id: 424242,
          method: 'fs.readFile',
          params: { uri: `file:///${target.replace(/\\/g, '/')}` },
        });
      });
    }, filePath);

    expect(response.error?.code).toBe(-32001);
    expect(response.error?.message).toMatch(/拒绝访问/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('有未保存修改时关闭窗口必须确认', async () => {
  const { directory, filePath } = await createFixture(
    'close-test.cpp',
    'int main() { return 0; }\n',
  );
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');

    await mockOpenFileDialog(app, filePath);
    await page.locator('.oi-topbar').getByRole('button', { name: '打开文件' }).click();
    await expect(page.locator('.oi-doc-name')).toHaveText('close-test.cpp');

    await page.locator('.monaco-editor').click();
    await page.keyboard.press(CURSOR_TO_END);
    await page.keyboard.type('// dirty');
    await expect(page.locator('.oi-dirty-dot')).toBeAttached();

    // 第一次关闭：选择“返回编辑”后窗口必须保留
    await mockCloseDialog(app, 1);
    await closeWindow(app);
    await page.waitForTimeout(300);
    expect(app.windows()).toHaveLength(1);

    // 第二次关闭：确认放弃后进程退出
    await mockCloseDialog(app, 0);
    const closed = app.waitForEvent('close');
    await closeWindow(app);
    await closed;
  } finally {
    await app.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
