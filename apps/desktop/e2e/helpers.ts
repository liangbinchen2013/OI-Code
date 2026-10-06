import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

const specDir = dirname(fileURLToPath(import.meta.url));

export const mainEntry = resolve(specDir, '../../../dist/desktop/main.cjs');

/**
 * 默认启动构建产物；设置 OI_E2E_EXECUTABLE 时改为启动打包后的可执行文件。
 * 每次启动使用独立 userData，避免测试间共享主题、日志等本地状态。
 */
export async function launchApp(): Promise<ElectronApplication> {
  const executablePath = process.env['OI_E2E_EXECUTABLE'];
  const userDataDir = await mkdtemp(join(tmpdir(), 'oi-code-userdata-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env['OI_CODE_USER_DATA'] = userDataDir;
  return electron.launch(
    executablePath === undefined ? { args: [mainEntry], env } : { executablePath, env },
  );
}

/**
 * 替换主进程的打开文件对话框，模拟用户选中指定路径。
 */
export async function mockOpenFileDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, filePath);
}

/**
 * 替换主进程的关闭确认框，模拟用户点击第 response 个按钮（0 = 放弃修改并关闭）。
 */
export async function mockCloseDialog(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showMessageBox = async () => ({ response: selected, checkboxChecked: false });
  }, response);
}
