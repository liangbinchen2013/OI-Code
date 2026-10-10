import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers';

async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-oi-code-ready', 'true');
}

/**
 * 造一次真实拖放：JS 里 `new File(...)` 没有磁盘 backing，`webUtils.getPathForFile`
 * 只会返回空串；经 `<input type=file>` 拿到的 File 才有真实路径，
 * 于是 preload 解析、主进程放行、文件服务读取整条链路都按生产代码走。
 */
async function dropOntoEditor(page: Page, files: readonly string[]): Promise<void> {
  await page.evaluate(() => {
    if (!document.getElementById('drop-probe')) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.id = 'drop-probe';
      document.body.append(input);
    }
  });
  await page.locator('#drop-probe').setInputFiles(files);
  await page.evaluate(
    (names) => {
      const input = document.getElementById('drop-probe') as HTMLInputElement;
      const main = document.querySelector('.oi-main');
      if (!input?.files || !main) {
        throw new Error('找不到拖放目标');
      }
      const transfer = new DataTransfer();
      names.forEach((name) => {
        const file = Array.from(input.files ?? []).find((entry) => entry.name === name);
        if (file) {
          transfer.items.add(file);
        }
      });
      main.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      main.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    files.map((path) => path.split(/[\\/]/).pop() ?? path),
  );
}

async function makeSample(directory: string, name: string, text: string): Promise<string> {
  const filePath = join(directory, name);
  await writeFile(filePath, text, 'utf8');
  return filePath;
}

test('拖放文件到编辑区即打开', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'oi-code-drop-'));
  const first = await makeSample(
    directory,
    'first.cpp',
    '#include <cstdio>\nint main(){ return 1; }\n',
  );
  const second = await makeSample(
    directory,
    'second.cpp',
    '#include <cstdio>\nint main(){ return 2; }\n',
  );

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    const main = page.locator('.oi-main');

    await dropOntoEditor(page, [first, second]);

    // 两个文件都开成标签，后拖入的成为当前标签
    await expect(page.locator('.oi-tab-name')).toHaveText(['first.cpp', 'second.cpp']);
    await expect(page.locator('.oi-tab-active .oi-tab-name')).toHaveText('second.cpp');
    await expect(page.locator('.view-lines').first()).toContainText('return 2');
    // 松开后提示层消失
    await expect(main.locator('.oi-drop-hint')).toHaveCount(0);
    // 拖放不得让窗口导航到 file://
    expect(page.url()).not.toContain('first.cpp');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('拖放悬停显示可放置提示，取不到路径时可见地报错', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    const main = page.locator('.oi-main');

    // JS 构造的 File 没有磁盘路径，应当提示而不是静默
    await page.evaluate(() => {
      const target = document.querySelector('.oi-main');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['x'], 'synthetic.cpp', { type: 'text/plain' }));
      target?.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    });
    await expect(main.locator('.oi-drop-hint')).toBeVisible();

    await page.evaluate(() => {
      const target = document.querySelector('.oi-main');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['x'], 'synthetic.cpp', { type: 'text/plain' }));
      target?.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    });
    await expect(page.locator('.oi-status-capsule')).toContainText('无法取得拖放文件的路径');
    await expect(main.locator('.oi-drop-hint')).toHaveCount(0);
    await expect(page.locator('.oi-tab-name')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('拖到编辑区之外不会整窗导航', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await waitReady(page);
    const urlBefore = page.url();

    const prevented = await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['x'], 'elsewhere.cpp', { type: 'text/plain' }));
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      document.querySelector('.oi-activitybar')?.dispatchEvent(event);
      return event.defaultPrevented;
    });

    expect(prevented).toBe(true);
    expect(page.url()).toBe(urlBefore);
  } finally {
    await app.close();
  }
});
