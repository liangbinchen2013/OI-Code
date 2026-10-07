import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockCloseDialog, mockOpenFileDialog } from './helpers';

function hasCommand(name: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function executableOf(sourcePath: string): string {
  const base = sourcePath.replace(/\.(cpp|cc|cxx|c)$/i, '');
  return process.platform === 'win32' ? `${base}.exe` : base;
}

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

/** 首个文件从空态打开，之后经设置页打开（侧边栏与空态没有重复入口）。 */
async function openFile(
  app: Awaited<ReturnType<typeof launchApp>>,
  page: Page,
  filePath: string,
): Promise<void> {
  await mockOpenFileDialog(app, filePath);
  const emptyButton = page
    .locator('.oi-empty-state')
    .getByRole('button', { name: '打开文件', exact: true });
  if ((await emptyButton.count()) > 0) {
    await emptyButton.click();
  } else {
    await page.locator('.oi-activity-item-settings').click();
    await page
      .locator('.oi-settings')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
  }
  await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText(basename(filePath));
}

test('编辑时实时诊断在防抖后标记错误并更新问题角标', async () => {
  test.setTimeout(120_000);
  test.skip(!hasCommand('g++'), '未安装 g++');
  const directory = await mkdtemp(join(tmpdir(), 'oi-e2e-live-'));
  const sourcePath = join(directory, 'live.cpp');
  await writeFile(sourcePath, 'int main() { return 0; }\n', 'utf8');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, sourcePath);
    await expect(page.locator('.squiggly-error')).toHaveCount(0);

    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('int main() { int value = ; }\n');

    await expect(page.locator('.squiggly-error').first()).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('.oi-problems-badge')).toBeVisible();
  } finally {
    // 文档仍为脏：关闭时自动确认放弃修改
    await mockCloseDialog(app, 0).catch(() => undefined);
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('设置页自动搜索 g++ 与 Python 并展示版本与支持标准', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();
    await expect(page.locator('.oi-settings')).toBeVisible();

    if (hasCommand('g++')) {
      await page.locator('.oi-cpp-search').click();
      const cppSection = page.locator('.oi-settings-section', { hasText: 'C++ 编译器' });
      await expect(cppSection.locator('.oi-settings-code')).toContainText('g++', {
        timeout: 60_000,
      });
      await expect(cppSection.locator('.oi-chip-list')).toContainText('c++17');
      await expect(cppSection.locator('select#oi-cpp-standard')).toBeVisible();
      // 搜索完成后以单选列表展示全部候选，当前默认项被标记
      await expect(cppSection.locator('.oi-cpp-candidate').first()).toBeVisible();
      await expect(cppSection.locator('.oi-cpp-candidate.oi-radio-row-active')).toHaveCount(1);
    }

    if (hasCommand('python')) {
      await page.locator('.oi-python-search').click();
      await expect(page.locator('.oi-python-list')).toContainText('Python 3', {
        timeout: 60_000,
      });
      await expect(page.locator('.oi-python-list .oi-radio-row-active')).toBeVisible();
    }
  } finally {
    await app.close();
  }
});

test('编译 C++ 成功产出可执行文件，编译并运行可启动程序', async () => {
  test.setTimeout(120_000);
  test.skip(!hasCommand('g++'), '未安装 g++');
  const directory = await mkdtemp(join(tmpdir(), 'oi-e2e-cpp-'));
  const sourcePath = join(directory, 'ok.cpp');
  await writeFile(
    sourcePath,
    '#include <cstdio>\nint main() { printf("ok"); return 0; }\n',
    'utf8',
  );
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, sourcePath);

    await page.locator('button[aria-label="编译"]').click();
    await expect(page.locator('.oi-status-capsule')).toContainText('编译成功', {
      timeout: 60_000,
    });
    expect(existsSync(executableOf(sourcePath))).toBe(true);

    await page.locator('button[aria-label="编译并运行"]').click();
    await expect(page.locator('.oi-status-capsule')).toContainText('已启动运行', {
      timeout: 60_000,
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('C++ 编译错误在问题面板按 行 | 列 | 原因 展示并标记编辑器', async () => {
  test.setTimeout(120_000);
  test.skip(!hasCommand('g++'), '未安装 g++');
  const directory = await mkdtemp(join(tmpdir(), 'oi-e2e-cpperr-'));
  const sourcePath = join(directory, 'bad.cpp');
  await writeFile(sourcePath, 'int main() {\n  int value = ;\n  return 0;\n}\n', 'utf8');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, sourcePath);

    await page.keyboard.press('F12');
    await expect(page.locator('.oi-status-capsule')).toContainText('编译失败', {
      timeout: 60_000,
    });

    const problems = page.locator('.oi-problems');
    await expect(problems).toBeVisible();
    const firstRow = problems.locator('.oi-problem-row').first();
    await expect(firstRow.locator('.oi-problem-location')).toHaveText(/^\d+ \| \d+$/);
    await expect(firstRow.locator('.oi-problem-location')).toHaveText(/^2 \| /);
    await expect(firstRow.locator('.oi-problem-message')).toContainText('expected');
    await expect(page.locator('.squiggly-error').first()).toBeAttached();

    await page.locator('button[aria-label="问题"]').click();
    await expect(problems).toBeHidden();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Python 语法检查经 F12 触发并标记错误，正确代码通过', async () => {
  test.setTimeout(120_000);
  test.skip(!hasCommand('python'), '未安装 python');
  const directory = await mkdtemp(join(tmpdir(), 'oi-e2e-py-'));
  const badPath = join(directory, 'bad.py');
  const goodPath = join(directory, 'good.py');
  await writeFile(badPath, 'def solve(:\n    pass\n', 'utf8');
  await writeFile(goodPath, 'def solve():\n    return 0\n', 'utf8');
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, badPath);

    await page.keyboard.press('F12');
    await expect(page.locator('.oi-status-capsule')).toContainText('发现语法问题', {
      timeout: 60_000,
    });
    await expect(page.locator('.oi-problems .oi-problem-row').first()).toBeVisible();
    await expect(page.locator('.squiggly-error').first()).toBeAttached();

    await openFile(app, page, goodPath);
    await page.keyboard.press('F12');
    await expect(page.locator('.oi-status-capsule')).toContainText('语法检查通过', {
      timeout: 60_000,
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('强力搜索在限定根目录内发现 g++ 并支持点选为默认', async () => {
  test.setTimeout(180_000);
  test.skip(!hasCommand('g++'), '未安装 g++');
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const gppPath = execFileSync(command, ['g++'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  expect(gppPath).toBeTruthy();
  if (gppPath === undefined) {
    return;
  }

  // 限定扫描根为 g++ 所在目录，避免 E2E 全盘扫描
  const app = await launchApp({ env: { OI_FORCE_SEARCH_ROOTS: dirname(gppPath) } });
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item-settings').click();
    await page.locator('.oi-cpp-force-search').click();

    const candidates = page.locator('.oi-cpp-candidates .oi-cpp-candidate');
    await expect(candidates.first()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.oi-cpp-candidates .oi-radio-row-active')).toHaveCount(1);
    await expect(page.locator('.oi-candidate-source').first()).toBeVisible();

    // 点击候选立即生效为默认编译器
    await candidates.first().click();
    await expect(candidates.first()).toHaveClass(/oi-radio-row-active/, { timeout: 60_000 });
    const cppSection = page.locator('.oi-settings-section', { hasText: 'C++ 编译器' });
    await expect(cppSection.locator('select#oi-cpp-standard')).toBeVisible();
  } finally {
    await app.close();
  }
});
