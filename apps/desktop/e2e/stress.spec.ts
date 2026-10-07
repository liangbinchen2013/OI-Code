import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockOpenFileDialog } from './helpers';

const SUM_SOURCE = [
  '#include <cstdio>',
  'int main() { int a, b; if (scanf("%d %d", &a, &b) != 2) return 1; printf("%d\\n", a + b); return 0; }',
  '',
].join('\n');
const BAD_SOURCE = [
  '#include <cstdio>',
  'int main() { int a, b; if (scanf("%d %d", &a, &b) != 2) return 1; printf("%d\\n", a + b + 1); return 0; }',
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

test('对拍：一致时通过全部轮次，不一致时展示首个差异轮', async () => {
  test.setTimeout(240_000);
  test.skip(!hasCommand('g++'), '未安装 g++');

  const directory = await mkdtemp(join(tmpdir(), 'oi-code-stress-e2e-'));
  const generatorPath = join(directory, 'gen.cpp');
  const referencePath = join(directory, 'ref.cpp');
  const solutionPath = join(directory, 'sol.cpp');
  const badPath = join(directory, 'bad.cpp');
  await writeFile(
    generatorPath,
    '#include <cstdio>\nint main() { printf("1 2\\n"); return 0; }\n',
    'utf8',
  );
  await writeFile(referencePath, SUM_SOURCE, 'utf8');
  await writeFile(solutionPath, SUM_SOURCE, 'utf8');
  await writeFile(badPath, BAD_SOURCE, 'utf8');

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
    await page.locator('.oi-tool-stress').click();
    await expect(page.locator('.oi-stress')).toBeVisible();

    await mockOpenFileDialog(app, generatorPath);
    await page.locator('.oi-stress-generator').click();
    await mockOpenFileDialog(app, referencePath);
    await page.locator('.oi-stress-reference').click();
    await mockOpenFileDialog(app, solutionPath);
    await page.locator('.oi-stress-solution').click();
    await expect(page.locator('.oi-stress-generator')).toContainText('gen.cpp');
    await expect(page.locator('.oi-stress-reference')).toContainText('ref.cpp');
    await expect(page.locator('.oi-stress-solution')).toContainText('sol.cpp');

    await page.locator('.oi-stress-iterations').fill('5');
    await page.locator('.oi-stress-start').click();
    await expect(page.locator('.oi-stress-summary')).toContainText('对拍通过 5 次', {
      timeout: 180_000,
    });

    // 换成错误程序 → 第 1 轮即发现不一致
    await mockOpenFileDialog(app, badPath);
    await page.locator('.oi-stress-solution').click();
    await expect(page.locator('.oi-stress-solution')).toContainText('bad.cpp');
    await page.locator('.oi-stress-start').click();
    await expect(page.locator('.oi-stress-summary')).toContainText('第 1 次输出不一致', {
      timeout: 180_000,
    });
    await expect(page.locator('.oi-stress-input-data')).toContainText('1 2');
    await expect(page.locator('.oi-stress-expected-data')).toContainText('3');
    await expect(page.locator('.oi-stress-actual-data')).toContainText('4');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
