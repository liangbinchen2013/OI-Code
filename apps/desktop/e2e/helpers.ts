import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

const specDir = dirname(fileURLToPath(import.meta.url));

export const mainEntry = resolve(specDir, '../../../dist/desktop/main.cjs');

/**
 * 默认启动构建产物；设置 OI_E2E_EXECUTABLE 时改为启动打包后的可执行文件。
 */
export async function launchApp(): Promise<ElectronApplication> {
  const executablePath = process.env['OI_E2E_EXECUTABLE'];
  return electron.launch(executablePath ? { executablePath } : { args: [mainEntry] });
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
