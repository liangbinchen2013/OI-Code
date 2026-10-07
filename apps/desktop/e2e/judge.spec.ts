import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockOpenFileDialog, mockOpenFolderDialog } from './helpers';

const SUM_SOURCE = [
  '#include <cstdio>',
  'int main() { int a, b; if (scanf("%d %d", &a, &b) != 2) return 1; printf("%d\\n", a + b); return 0; }',
  '',
].join('\n');

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

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

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
  await expect(page.locator('.oi-tab-active .oi-tab-name')).toBeVisible();
}

async function addCase(page: Page, name: string, input: string, expected: string): Promise<void> {
  await page.locator('.oi-judge-add').click();
  await page.locator('.oi-judge-name').fill(name);
  await page.locator('.oi-judge-input').fill(input);
  await page.locator('.oi-judge-expected').fill(expected);
  await page.locator('.oi-judge-save').click();
}

test('简易评测机：手动测试点判定 AC/WA，文件夹与压缩包导入数据', async () => {
  test.setTimeout(240_000);
  test.skip(!hasCommand('g++'), '未安装 g++');

  const directory = await mkdtemp(join(tmpdir(), 'oi-code-judge-e2e-'));
  const sourcePath = join(directory, 'sum.cpp');
  await writeFile(sourcePath, SUM_SOURCE, 'utf8');
  const dataDir = join(directory, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 't1.in'), '3 4\n', 'utf8');
  await writeFile(join(dataDir, 't1.out'), '7\n', 'utf8');
  await writeFile(join(dataDir, 't2.in'), '10 20\n', 'utf8');
  await writeFile(join(dataDir, 't2.ans'), '30\n', 'utf8');
  const zipPath = join(directory, 'data.zip');
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${dataDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'ignore' },
    );
  }

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFile(app, page, sourcePath);

    await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
    await page.locator('.oi-tool-judge').click();
    await expect(page.locator('.oi-judge')).toBeVisible();

    await addCase(page, 'p1', '1 2\n', '3\n');
    await addCase(page, 'p2', '5 7\n', '12\n');
    await expect(page.locator('.oi-judge-case-row')).toHaveCount(2);

    await page.locator('.oi-judge-run').click();
    await expect(page.locator('.oi-judge-result-row')).toHaveCount(2, { timeout: 120_000 });
    await expect(page.locator('.oi-judge-results')).toContainText('AC');

    // 修改第二个测试点期望输出 → WA
    await page
      .locator('.oi-judge-case-row', { hasText: 'p2' })
      .locator('.oi-judge-case-edit')
      .click();
    await page.locator('.oi-judge-expected').fill('99\n');
    await page.locator('.oi-judge-save').click();
    await page.locator('.oi-judge-run').click();
    await expect(
      page.locator('.oi-judge-result-row', { hasText: 'p2' }).locator('.oi-judge-verdict-text'),
    ).toHaveText('WA', { timeout: 120_000 });

    // 文件夹导入：t1.in/t1.out 与 t2.in/t2.ans
    await mockOpenFolderDialog(app, dataDir);
    await page.locator('.oi-judge-import-folder').click();
    await expect(page.locator('.oi-judge-notice')).toContainText('已导入 2 个测试点', {
      timeout: 30_000,
    });
    await expect(page.locator('.oi-judge-case-row')).toHaveCount(4);

    // 压缩包导入（Windows 下用 Compress-Archive 构造）
    if (process.platform === 'win32') {
      await mockOpenFileDialog(app, zipPath);
      await page.locator('.oi-judge-import-zip').click();
      await expect(page.locator('.oi-judge-notice')).toContainText('已导入 2 个测试点', {
        timeout: 30_000,
      });
    }
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
