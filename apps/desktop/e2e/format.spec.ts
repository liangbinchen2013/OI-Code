import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, mockCloseDialog, mockOpenFileDialog } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

async function openFormatTool(page: Page): Promise<void> {
  await page.locator('.oi-activity-item[aria-label="OI 工具箱"]').click();
  await page.locator('.oi-tool-format').click();
  await expect(page.locator('.oi-format')).toBeVisible();
}

function toggle(page: Page, label: string): Page['locator'] {
  return page.locator('.oi-format-toggle', { hasText: label }).locator('input');
}

test('代码格式化工具：按样本反推风格并格式化代码', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    await openFormatTool(page);

    // 贴一段紧凑 + Tab 缩进的样本，分析后开关应跟着变
    await page
      .locator('.oi-format-sample')
      .fill('int main(){\n\tint n;\n\tif(n>0) cout<<n;\n\treturn 0;\n}\n');
    await page.locator('.oi-format-analyze').click();

    await expect(toggle(page, '缩进用 Tab')).toBeChecked();
    await expect(toggle(page, '关键字后空格')).not.toBeChecked();
    await expect(toggle(page, '运算符两侧空格')).not.toBeChecked();
    await expect(page.locator('.oi-format-confidence')).toBeVisible();

    // 用刚学到的风格格式化另一段代码
    await page.locator('.oi-format-input').fill('int main(){int a;a=1+2;return a;}');
    await page.locator('.oi-format-run').click();

    const output = await page.locator('.oi-format-output').inputValue();
    expect(output).toContain('int a;');
    expect(output).toContain('a=1+2;');
    expect(output).toContain('\t');
    expect(output).not.toContain('if (');
    await expect(page.locator('.oi-format-notice')).toBeVisible();

    // 手动勾回"关键字后空格"，结果应随之变化
    await toggle(page, '关键字后空格').check();
    await page.locator('.oi-format-input').fill('int main(){ if(n>0) f(); }');
    await page.locator('.oi-format-run').click();
    expect(await page.locator('.oi-format-output').inputValue()).toContain('if (n>0)');
  } finally {
    await app.close();
  }
});

test('编辑器 Shift+Alt+F 原地格式化并可撤销', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-format-'));
  const filePath = join(directory, 'main.cpp');
  await writeFile(filePath, 'int main(){int n;cin>>n;if(n>0)cout<<n;return 0;}\n', 'utf8');

  const app = await launchApp();
  try {
    // 格式化会让文档变脏，关闭时必须有确认框可自动应答，否则 app.close() 会挂住
    await mockCloseDialog(app, 0);
    const page = await app.firstWindow();
    await waitReady(page);
    await mockOpenFileDialog(app, filePath);
    await page
      .locator('.oi-empty-state')
      .getByRole('button', { name: '打开文件', exact: true })
      .click();
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('main.cpp');

    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Shift+Alt+f');

    await expect(page.locator('.oi-status-capsule')).toContainText('已格式化');
    await expect(page.locator('.view-lines')).toContainText('int n;');
    await expect(page.locator('.view-lines')).toContainText('if (n > 0)');
    // 格式化后文档应变脏（可保存 / 可撤销）
    await expect(page.locator('.oi-tab-active .oi-dirty-dot')).toBeAttached();

    await page.keyboard.press('Control+z');
    await expect(page.locator('.view-lines')).toContainText('int main(){int n;');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
