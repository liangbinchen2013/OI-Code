import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

const specDir = dirname(fileURLToPath(import.meta.url));

export const mainEntry = resolve(specDir, '../../../dist/desktop/main.cjs');

export interface ILaunchOptions {
  /** 复用既有 userData 目录（自动保存恢复用例跨重启复用）。 */
  readonly userDataDir?: string;
  /** 追加/覆盖环境变量（如 OI_FORCE_SEARCH_ROOTS 限定强力搜索范围）。 */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * 默认启动构建产物；设置 OI_E2E_EXECUTABLE 时改为启动打包后的可执行文件。
 * 每次启动使用独立 userData，避免测试间共享主题、日志等本地状态；
 * 自动保存草稿隔离到各自 userData，避免跨用例污染系统临时目录。
 */
export async function launchApp(options: ILaunchOptions = {}): Promise<ElectronApplication> {
  const executablePath = process.env['OI_E2E_EXECUTABLE'];
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), 'oi-code-userdata-')));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env['OI_CODE_USER_DATA'] = userDataDir;
  env['OI_CODE_AUTOSAVE_DIR'] = join(userDataDir, 'autosave');
  // E2E 中运行器不等待按键，避免遗留控制台窗口
  env['OI_RUNNER_NO_PAUSE'] = '1';
  // 默认跳过首次启动环境自检（既有用例不依赖工具链弹窗；专项用例显式开启）
  env['OI_SKIP_ENV_BOOTSTRAP'] = '1';
  for (const [key, value] of Object.entries(options.env ?? {})) {
    env[key] = value;
  }
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
 * 替换主进程的打开文件夹对话框，模拟用户选中指定目录。
 */
export async function mockOpenFolderDialog(
  app: ElectronApplication,
  directory: string,
): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, directory);
}

/**
 * 替换主进程的另存为对话框，模拟用户选定保存路径。
 */
export async function mockSaveFileDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected });
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
