import { join } from 'node:path';
import { BrowserWindow, Menu, app, dialog, ipcMain, shell, type IpcMainEvent } from 'electron';
import {
  DisposableStore,
  type IDisposable,
  URI,
  onUnexpectedError,
  toDisposable,
  toError,
} from '@oi/base';
import {
  APP_RPC_ERROR_CODES,
  AUTOSAVE_RPC_METHODS,
  DIALOG_RPC_METHODS,
  FILE_RPC_METHODS,
  IAutoSaveService,
  IFileDialogService,
  IFileService,
  IJudgeService,
  ILogService,
  IPythonService,
  IToolchainService,
  IVjudgeService,
  JSON_RPC_ERROR_CODES,
  JUDGE_RPC_METHODS,
  JUDGE_RPC_NOTIFICATIONS,
  PYTHON_RPC_METHODS,
  PYTHON_RPC_NOTIFICATIONS,
  RpcChannel,
  RpcError,
  TOOLCHAIN_RPC_METHODS,
  TOOLCHAIN_RPC_NOTIFICATIONS,
  VJUDGE_RPC_METHODS,
  VJUDGE_RPC_NOTIFICATIONS,
  WINDOW_RPC_NOTIFICATIONS,
  serializeDiagnostic,
  type IMessageTransport,
  type IOpenFileDialogOptions,
  type IPipInstallRequest,
  type ISaveFileDialogOptions,
  type ITestCase,
  type IJudgeRequest,
  type IStressRequest,
  type IVjudgeSubmitRequest,
} from '@oi/platform';
import { FileLogger } from '@oi/platform/node';
import { RPC_CHANNEL_NAME } from '../common/ipc';
import { FileAccessGuard } from './fileAccessGuard';

const WINDOW_MIN_WIDTH = 720;

function parseUriParam(params: unknown): URI {
  if (typeof params !== 'object' || params === null || !('uri' in params)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少 uri 参数');
  }
  const { uri } = params as { uri: unknown };
  if (typeof uri !== 'string') {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'uri 参数必须是字符串');
  }
  return URI.parse(uri);
}

function parseContentParam(params: unknown): string {
  if (typeof params !== 'object' || params === null || !('content' in params)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少 content 参数');
  }
  const { content } = params as { content: unknown };
  if (typeof content !== 'string') {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'content 参数必须是字符串');
  }
  return content;
}

function parseOpenOptions(params: unknown): IOpenFileDialogOptions | undefined {
  if (typeof params !== 'object' || params === null || !('options' in params)) {
    return undefined;
  }
  const { options } = params as { options: unknown };
  if (typeof options !== 'object' || options === null) {
    return undefined;
  }
  const { title, filters } = options as { title?: unknown; filters?: unknown };
  const parsedFilters = Array.isArray(filters)
    ? filters.flatMap((filter) => {
        if (typeof filter !== 'object' || filter === null) {
          return [];
        }
        const { name, extensions } = filter as { name?: unknown; extensions?: unknown };
        if (typeof name !== 'string' || !Array.isArray(extensions)) {
          return [];
        }
        return [{ name, extensions: extensions.filter((ext) => typeof ext === 'string') }];
      })
    : [];
  return {
    ...(typeof title === 'string' ? { title } : {}),
    filters: parsedFilters,
  };
}

function parseSaveOptions(params: unknown): ISaveFileDialogOptions | undefined {
  if (typeof params !== 'object' || params === null || !('options' in params)) {
    return undefined;
  }
  const { options } = params as { options: unknown };
  if (typeof options !== 'object' || options === null) {
    return undefined;
  }
  const { title, defaultPath } = options as { title?: unknown; defaultPath?: unknown };
  return {
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
}

function parseFileNameParam(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || !('fileName' in params)) {
    return undefined;
  }
  const { fileName } = params as { fileName: unknown };
  return typeof fileName === 'string' ? fileName : undefined;
}

const MAX_DROPPED_PATHS = 32;

/** 解析拖放授权通知：只接受非空字符串数组，超限直接忽略。 */
function parseDroppedPaths(params: unknown): readonly string[] | undefined {
  if (typeof params !== 'object' || params === null || !('paths' in params)) {
    return undefined;
  }
  const { paths } = params as { paths: unknown };
  if (!Array.isArray(paths) || paths.length > MAX_DROPPED_PATHS) {
    return undefined;
  }
  const accepted = paths.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
  return accepted.length === paths.length ? accepted : undefined;
}

function parseDirtyParam(params: unknown): boolean | undefined {
  if (typeof params !== 'object' || params === null || !('dirty' in params)) {
    return undefined;
  }
  const { dirty } = params as { dirty: unknown };
  return typeof dirty === 'boolean' ? dirty : undefined;
}

const CPP_STANDARD_PATTERN = /^c\+\+\d{2,4}$/;

function parseStandardParam(params: unknown): string {
  if (typeof params !== 'object' || params === null || !('standard' in params)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少 standard 参数');
  }
  const { standard } = params as { standard: unknown };
  if (typeof standard !== 'string' || !CPP_STANDARD_PATTERN.test(standard)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'standard 参数非法');
  }
  return standard;
}

function parseOptionalStandardParam(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || !('standard' in params)) {
    return undefined;
  }
  const { standard } = params as { standard: unknown };
  if (standard === undefined) {
    return undefined;
  }
  if (typeof standard !== 'string' || !CPP_STANDARD_PATTERN.test(standard)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'standard 参数非法');
  }
  return standard;
}

const MAX_CUSTOM_FLAGS_LENGTH = 2000;

function parseFlagsParam(params: unknown): string {
  if (typeof params !== 'object' || params === null || !('flags' in params)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少 flags 参数');
  }
  const { flags } = params as { flags?: unknown };
  if (typeof flags !== 'string' || flags.length > MAX_CUSTOM_FLAGS_LENGTH || /[\r\n]/.test(flags)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'flags 参数非法');
  }
  return flags;
}

function parseRequiredPathParam(params: unknown, label: string): string {
  if (typeof params !== 'object' || params === null || !('path' in params)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `缺少 ${label} 参数`);
  }
  const { path } = params as { path: unknown };
  if (typeof path !== 'string' || path.length === 0) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `${label} 参数非法`);
  }
  return path;
}

function parseDraftParams(params: unknown): { uri: string; content: string } {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少草稿参数');
  }
  const { uri, content } = params as { uri?: unknown; content?: unknown };
  if (typeof uri !== 'string' || uri.length === 0 || typeof content !== 'string') {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '草稿参数非法');
  }
  return { uri, content };
}

function parseDraftUri(params: unknown): string {
  if (typeof params !== 'object' || params === null || !('uri' in params)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少 uri 参数');
  }
  const { uri } = params as { uri?: unknown };
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'uri 参数非法');
  }
  return uri;
}

function parsePipRequestParam(params: unknown): IPipInstallRequest {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少 pip 安装参数');
  }
  const { packageName, version, useTsinghuaMirror, interpreterPath } = params as {
    packageName?: unknown;
    version?: unknown;
    useTsinghuaMirror?: unknown;
    interpreterPath?: unknown;
  };
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'packageName 参数非法');
  }
  return {
    packageName,
    ...(typeof version === 'string' && version.length > 0 ? { version } : {}),
    useTsinghuaMirror: useTsinghuaMirror === true,
    ...(typeof interpreterPath === 'string' && interpreterPath.length > 0
      ? { interpreterPath }
      : {}),
  };
}

const MAX_JUDGE_CASES = 100;

function parseTestCase(value: unknown): ITestCase | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { name, input, expectedOutput } = value as {
    name?: unknown;
    input?: unknown;
    expectedOutput?: unknown;
  };
  if (typeof input !== 'string' || typeof expectedOutput !== 'string') {
    return undefined;
  }
  return {
    name: typeof name === 'string' && name.length > 0 ? name : '测试点',
    input,
    expectedOutput,
  };
}

function parseJudgeRunRequest(params: unknown): IJudgeRequest {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少评测参数');
  }
  const { content, language, timeLimitMs, memoryLimitMb, cases } = params as {
    content?: unknown;
    language?: unknown;
    timeLimitMs?: unknown;
    memoryLimitMb?: unknown;
    cases?: unknown;
  };
  if (typeof content !== 'string') {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'content 参数非法');
  }
  if (language !== 'cpp' && language !== 'python') {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, 'language 参数非法');
  }
  const parsedCases = Array.isArray(cases)
    ? cases.flatMap((entry) => {
        const testCase = parseTestCase(entry);
        return testCase === undefined ? [] : [testCase];
      })
    : [];
  if (parsedCases.length === 0) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '至少需要一个测试点');
  }
  if (parsedCases.length > MAX_JUDGE_CASES) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `测试点过多（上限 ${MAX_JUDGE_CASES}）`);
  }
  const timeLimit =
    typeof timeLimitMs === 'number' && timeLimitMs >= 100 && timeLimitMs <= 60_000
      ? Math.round(timeLimitMs)
      : 1000;
  const memoryLimit =
    typeof memoryLimitMb === 'number' && memoryLimitMb >= 0 && memoryLimitMb <= 4096
      ? Math.round(memoryLimitMb)
      : 256;
  return {
    content,
    language,
    timeLimitMs: timeLimit,
    memoryLimitMb: memoryLimit,
    cases: parsedCases,
  };
}

function parseStressRequest(params: unknown): {
  readonly paths: readonly [string, string, string];
  readonly iterations: number;
  readonly timeLimitMs: number;
} {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少对拍参数');
  }
  const { generatorUri, referenceUri, solutionUri, iterations, timeLimitMs } = params as {
    generatorUri?: unknown;
    referenceUri?: unknown;
    solutionUri?: unknown;
    iterations?: unknown;
    timeLimitMs?: unknown;
  };
  if (
    typeof generatorUri !== 'string' ||
    typeof referenceUri !== 'string' ||
    typeof solutionUri !== 'string'
  ) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '对拍文件参数非法');
  }
  const iterationCount =
    typeof iterations === 'number' && iterations >= 1 && iterations <= 10_000
      ? Math.round(iterations)
      : 100;
  const timeLimit =
    typeof timeLimitMs === 'number' && timeLimitMs >= 100 && timeLimitMs <= 60_000
      ? Math.round(timeLimitMs)
      : 1000;
  return {
    paths: [generatorUri, referenceUri, solutionUri],
    iterations: iterationCount,
    timeLimitMs: timeLimit,
  };
}

function parseParamsObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, '缺少参数对象');
  }
  return params as Record<string, unknown>;
}

function readRequiredString(params: unknown, key: string): string {
  const value = parseParamsObject(params)[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `${key} 参数必须是非空字符串`);
  }
  return value.trim();
}

/** 与 readRequiredString 不同：不裁剪首尾空白，用于源码等必须逐字保真的字段。 */
function readRequiredText(params: unknown, key: string): string {
  const value = parseParamsObject(params)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `${key} 参数不能为空`);
  }
  return value;
}

function readOptionalString(params: unknown, key: string): string | undefined {
  const value = parseParamsObject(params)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readRequiredNumber(params: unknown, key: string): number {
  const value = parseParamsObject(params)[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `${key} 参数必须是数字`);
  }
  return value;
}

function readOptionalNumber(params: unknown, key: string): number | undefined {
  const value = parseParamsObject(params)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(params: unknown, key: string): boolean | undefined {
  const value = parseParamsObject(params)[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 主进程：窗口生命周期、IPC 服务端与文件访问授权。
 */
export class MainProcess implements IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _fileAccess = new FileAccessGuard();
  private readonly _dirtyWindows = new Map<number, boolean>();
  private readonly _closeConfirmedWindows = new Set<number>();
  private _draftsCleared = false;

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IFileService private readonly _fileService: IFileService,
    @IFileDialogService private readonly _fileDialogService: IFileDialogService,
    @IToolchainService private readonly _toolchainService: IToolchainService,
    @IPythonService private readonly _pythonService: IPythonService,
    @IAutoSaveService private readonly _autoSaveService: IAutoSaveService,
    @IJudgeService private readonly _judgeService: IJudgeService,
    @IVjudgeService private readonly _vjudgeService: IVjudgeService,
  ) {}

  start(): void {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this._openWindow();
      }
    });
    // 正常退出：先清理自动保存草稿再放行（崩溃/断电不触发，留给下次启动恢复）
    const handleBeforeQuit = (event: { preventDefault(): void }): void => {
      if (this._draftsCleared) {
        return;
      }
      event.preventDefault();
      void this._autoSaveService
        .clearAllDrafts()
        .catch(onUnexpectedError)
        .finally(() => {
          this._draftsCleared = true;
          app.quit();
        });
    };
    app.on('before-quit', handleBeforeQuit);
    this._disposables.add(toDisposable(() => app.removeListener('before-quit', handleBeforeQuit)));
    void app.whenReady().then(
      () => {
        this._disposables.add(
          this._logService.addLogger(new FileLogger(join(app.getPath('logs'), 'oi-code.log'))),
        );
        // 移除原生菜单栏：界面完全由应用内 UI 承载（Electron 默认会挂菜单）
        Menu.setApplicationMenu(null);
        this._openWindow();
      },
      (error: unknown) => {
        onUnexpectedError(error);
        app.quit();
      },
    );
  }

  dispose(): void {
    this._disposables.dispose();
  }

  private _openWindow(): void {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: WINDOW_MIN_WIDTH,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // OI 工具箱内置浏览器依赖 webview；访客页面不启用 Node 能力
        webviewTag: true,
        // 首次启动自动全盘强力搜索仅限打包版；开发/E2E 可用 OI_AUTO_FORCE_SEARCH=1 显式开启
        additionalArguments: [
          `--oi-allow-auto-force-search=${String(
            app.isPackaged || process.env['OI_AUTO_FORCE_SEARCH'] === '1',
          )}`,
          `--oi-skip-env-bootstrap=${String(process.env['OI_SKIP_ENV_BOOTSTRAP'] === '1')}`,
        ],
      },
    });
    window.once('ready-to-show', () => {
      window.show();
    });
    // 渲染内容含第三方题面等外部链接：主窗口只允许停留在应用自身页面，
    // 其余一律交给系统浏览器，避免外部页面拿到注入了 preload 桥的窗口
    const devServerUrl = process.env['OI_CODE_DEV_SERVER_URL'];
    const appOrigin = devServerUrl ? new URL(devServerUrl).origin : 'file://';
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (this._isInternalUrl(targetUrl, appOrigin)) {
        return;
      }
      event.preventDefault();
      this._openExternally(targetUrl);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      this._openExternally(url);
      return { action: 'deny' };
    });
    window.on('close', (event) => {
      this._handleWindowClose(window, event);
    });
    window.on('closed', () => {
      this._dirtyWindows.delete(window.id);
      this._closeConfirmedWindows.delete(window.id);
    });

    const channel = new RpcChannel(this._createTransport(window));
    this._disposables.add(channel);
    this._registerMethods(channel, window);

    if (devServerUrl) {
      void window.loadURL(devServerUrl);
    } else {
      void window.loadFile(join(__dirname, 'renderer', 'index.html'));
    }
  }

  /** 应用自身页面（开发服务器同源或打包后的 file:// 页面）才允许在主窗口内导航。 */
  private _isInternalUrl(url: string, appOrigin: string): boolean {
    try {
      const target = new URL(url);
      if (target.protocol === 'about:' || target.protocol === 'data:') {
        return true;
      }
      return appOrigin === 'file://' ? target.protocol === 'file:' : target.origin === appOrigin;
    } catch {
      return false;
    }
  }

  /** 外部地址交给系统浏览器；非 http(s) 协议直接丢弃。 */
  private _openExternally(url: string): void {
    if (!/^https?:/i.test(url)) {
      this._logService.warn(`已拒绝打开非 http(s) 地址：${url.slice(0, 120)}`);
      return;
    }
    void shell.openExternal(url).catch((error: unknown) => {
      this._logService.warn(`调用系统浏览器失败：${toError(error).message}`);
    });
  }

  private _registerMethods(channel: RpcChannel, window: BrowserWindow): void {
    channel.registerMethod('ping', () => ({ pong: true, pid: process.pid }));

    channel.registerMethod(FILE_RPC_METHODS.readFile, (params) =>
      this._fileService.readFile(this._authorizedUri(params)),
    );
    channel.registerMethod(FILE_RPC_METHODS.writeFile, async (params) => {
      const uri = this._authorizedUri(params);
      await this._fileService.writeFile(uri, parseContentParam(params));
    });
    channel.registerMethod(FILE_RPC_METHODS.exists, (params) =>
      this._fileService.exists(this._authorizedUri(params)),
    );
    channel.registerMethod(FILE_RPC_METHODS.readDirectory, async (params) => {
      const entries = await this._fileService.readDirectory(this._authorizedUri(params));
      // URI 转为字符串后才能安全穿越 IPC 结构化克隆
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        uri: entry.uri.toString(),
      }));
    });

    // 对话框是唯一授权入口：选中即加入白名单
    channel.registerMethod(DIALOG_RPC_METHODS.showOpenFile, async (params) => {
      const uri = await this._fileDialogService.showOpenFile(parseOpenOptions(params));
      if (!uri) {
        return undefined;
      }
      this._fileAccess.allowPath(uri.fsPath);
      return uri.toString();
    });
    channel.registerMethod(DIALOG_RPC_METHODS.showOpenFolder, async (params) => {
      const uri = await this._fileDialogService.showOpenFolder(parseOpenOptions(params));
      if (!uri) {
        return undefined;
      }
      this._fileAccess.allowDirectory(uri.fsPath);
      return uri.toString();
    });
    channel.registerMethod(DIALOG_RPC_METHODS.showSaveFile, async (params) => {
      const uri = await this._fileDialogService.showSaveFile(parseSaveOptions(params));
      if (!uri) {
        return undefined;
      }
      this._fileAccess.allowPath(uri.fsPath);
      return uri.toString();
    });
    channel.registerMethod(DIALOG_RPC_METHODS.confirmDiscardChanges, (params) =>
      this._fileDialogService.confirmDiscardChanges(parseFileNameParam(params)),
    );

    channel.registerMethod(AUTOSAVE_RPC_METHODS.saveDraft, async (params) => {
      const { uri, content } = parseDraftParams(params);
      await this._autoSaveService.saveDraft(uri, content);
    });
    channel.registerMethod(AUTOSAVE_RPC_METHODS.clearDraft, async (params) => {
      await this._autoSaveService.clearDraft(parseDraftUri(params));
    });
    channel.registerMethod(AUTOSAVE_RPC_METHODS.clearAllDrafts, () =>
      this._autoSaveService.clearAllDrafts(),
    );
    channel.registerMethod(AUTOSAVE_RPC_METHODS.scanDrafts, () =>
      this._autoSaveService.scanDrafts(),
    );

    channel.listen(WINDOW_RPC_NOTIFICATIONS.grantDroppedPaths, (params) => {
      const paths = parseDroppedPaths(params);
      if (paths === undefined) {
        this._logService.warn('已忽略格式错误的拖放授权通知');
        return;
      }
      // 路径由 preload 从真实 File 解析，等同用户主动拖入，故纳入白名单
      for (const path of paths) {
        this._fileAccess.allowPath(path);
      }
    });

    channel.listen(WINDOW_RPC_NOTIFICATIONS.setDirtyState, (params) => {
      const dirty = parseDirtyParam(params);
      if (dirty === undefined) {
        this._logService.warn('已忽略格式错误的脏状态通知');
        return;
      }
      this._dirtyWindows.set(window.id, dirty);
      if (dirty) {
        this._closeConfirmedWindows.delete(window.id);
      }
    });

    channel.registerMethod(TOOLCHAIN_RPC_METHODS.getStatus, () =>
      this._toolchainService.getStatus(),
    );
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.search, () =>
      this._toolchainService.search((progress) => {
        channel.notify(TOOLCHAIN_RPC_NOTIFICATIONS.searchProgress, progress);
      }),
    );
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.forceSearch, () =>
      this._toolchainService.forceSearch((progress) => {
        channel.notify(TOOLCHAIN_RPC_NOTIFICATIONS.searchProgress, progress);
      }),
    );
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.setDefaultCompiler, (params) =>
      this._toolchainService.setDefaultCompiler(parseRequiredPathParam(params, 'compilerPath')),
    );
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.setDefaultStandard, async (params) => {
      await this._toolchainService.setDefaultStandard(parseStandardParam(params));
    });
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.setCustomFlags, async (params) => {
      await this._toolchainService.setCustomFlags(parseFlagsParam(params));
    });
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.compile, async (params) => {
      const uri = this._authorizedUri(params);
      const standard = parseOptionalStandardParam(params);
      const result = await this._toolchainService.compile({
        uri,
        content: parseContentParam(params),
        ...(standard === undefined ? {} : { standard }),
      });
      return { ...result, diagnostics: result.diagnostics.map(serializeDiagnostic) };
    });
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.check, async (params) => {
      const uri = this._authorizedUri(params);
      const diagnostics = await this._toolchainService.check(uri, parseContentParam(params));
      return diagnostics.map(serializeDiagnostic);
    });
    channel.registerMethod(TOOLCHAIN_RPC_METHODS.run, (params) =>
      this._toolchainService.run(this._authorizedUri(params)),
    );

    channel.registerMethod(PYTHON_RPC_METHODS.getStatus, () => this._pythonService.getStatus());
    channel.registerMethod(PYTHON_RPC_METHODS.search, () =>
      this._pythonService.search((progress) => {
        channel.notify(PYTHON_RPC_NOTIFICATIONS.searchProgress, progress);
      }),
    );
    channel.registerMethod(PYTHON_RPC_METHODS.forceSearch, () =>
      this._pythonService.forceSearch((progress) => {
        channel.notify(PYTHON_RPC_NOTIFICATIONS.searchProgress, progress);
      }),
    );
    channel.registerMethod(PYTHON_RPC_METHODS.resolveInterpreterPath, () =>
      this._pythonService.resolveInterpreterPath(),
    );
    channel.registerMethod(PYTHON_RPC_METHODS.setDefaultInterpreter, async (params) => {
      await this._pythonService.setDefaultInterpreter(
        parseRequiredPathParam(params, 'interpreterPath'),
      );
    });
    channel.registerMethod(PYTHON_RPC_METHODS.pipInstall, (params) =>
      this._pythonService.pipInstall(parsePipRequestParam(params), (chunk) => {
        channel.notify(PYTHON_RPC_NOTIFICATIONS.pipOutput, chunk);
      }),
    );
    channel.registerMethod(PYTHON_RPC_METHODS.check, async (params) => {
      const uri = this._authorizedUri(params);
      const diagnostics = await this._pythonService.check(uri, parseContentParam(params));
      return diagnostics.map(serializeDiagnostic);
    });
    channel.registerMethod(PYTHON_RPC_METHODS.run, (params) =>
      this._pythonService.run(this._authorizedUri(params)),
    );

    channel.registerMethod(JUDGE_RPC_METHODS.run, (params) =>
      this._judgeService.run(parseJudgeRunRequest(params)),
    );
    channel.registerMethod(JUDGE_RPC_METHODS.stress, (params) => {
      const request = parseStressRequest(params);
      const [generator, reference, solution] = request.paths;
      const stressRequest: IStressRequest = {
        generatorUri: this._authorizedUriString(generator),
        referenceUri: this._authorizedUriString(reference),
        solutionUri: this._authorizedUriString(solution),
        iterations: request.iterations,
        timeLimitMs: request.timeLimitMs,
      };
      return this._judgeService.stress(stressRequest, (progress) => {
        channel.notify(JUDGE_RPC_NOTIFICATIONS.stressProgress, progress);
      });
    });
    channel.registerMethod(JUDGE_RPC_METHODS.cancelStress, () => this._judgeService.cancelStress());
    channel.registerMethod(JUDGE_RPC_METHODS.importDirectory, (params) =>
      this._judgeService.importDirectory(this._authorizedUri(params)),
    );
    channel.registerMethod(JUDGE_RPC_METHODS.importArchive, (params) =>
      this._judgeService.importArchive(this._authorizedUri(params)),
    );

    const submissionSubscription = this._vjudgeService.onDidSubmissionUpdate((submission) => {
      channel.notify(VJUDGE_RPC_NOTIFICATIONS.submissionUpdate, submission);
    });
    this._disposables.add(submissionSubscription);
    window.once('closed', () => submissionSubscription.dispose());
    channel.registerMethod(VJUDGE_RPC_METHODS.getConfig, () => this._vjudgeService.getConfig());
    channel.registerMethod(VJUDGE_RPC_METHODS.getAccount, () => this._vjudgeService.getAccount());
    channel.registerMethod(VJUDGE_RPC_METHODS.fetchProblem, (params) =>
      this._vjudgeService.fetchProblem(
        readRequiredString(params, 'oj'),
        readRequiredString(params, 'probNum'),
        readOptionalString(params, 'lang') ?? 'zh',
      ),
    );
    channel.registerMethod(VJUDGE_RPC_METHODS.submit, (params): Promise<number> => {
      const request: IVjudgeSubmitRequest = {
        language: readRequiredString(params, 'language'),
        ...(readOptionalNumber(params, 'method') === undefined
          ? {}
          : { method: readOptionalNumber(params, 'method') }),
        oj: readRequiredString(params, 'oj'),
        ...(readOptionalNumber(params, 'open') === undefined
          ? {}
          : { open: readOptionalNumber(params, 'open') }),
        probNum: readRequiredString(params, 'probNum'),
        source: readRequiredText(params, 'source'),
      };
      return this._vjudgeService.submit(request);
    });
    channel.registerMethod(VJUDGE_RPC_METHODS.getSubmission, (params) =>
      this._vjudgeService.getSubmission(
        readRequiredNumber(params, 'runId'),
        readOptionalBoolean(params, 'showCode') ?? false,
      ),
    );
    channel.registerMethod(VJUDGE_RPC_METHODS.watch, async (params) => {
      await this._vjudgeService.watch(readRequiredNumber(params, 'runId'));
    });
    channel.registerMethod(VJUDGE_RPC_METHODS.unwatch, async (params) => {
      await this._vjudgeService.unwatch(readRequiredNumber(params, 'runId'));
    });
    channel.registerMethod(VJUDGE_RPC_METHODS.getSolvedProblems, (params) =>
      this._vjudgeService.getSolvedProblems(readRequiredString(params, 'username')),
    );
  }

  private _authorizedUri(params: unknown): URI {
    const uri = parseUriParam(params);
    if (uri.scheme !== 'file') {
      throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `仅支持 file URI：${uri.toString()}`);
    }
    if (!this._fileAccess.isAllowed(uri.fsPath)) {
      this._logService.warn(`已拒绝未授权路径访问：${uri.fsPath}`);
      throw new RpcError(APP_RPC_ERROR_CODES.accessDenied, '该路径未经用户选择，已拒绝访问');
    }
    return uri;
  }

  private _authorizedUriString(value: string): URI {
    return this._authorizedUri({ uri: value });
  }

  private _handleWindowClose(window: BrowserWindow, event: { preventDefault(): void }): void {
    if (this._closeConfirmedWindows.has(window.id) || !this._dirtyWindows.get(window.id)) {
      return;
    }
    event.preventDefault();
    const options = {
      type: 'warning' as const,
      buttons: ['放弃修改并关闭', '返回编辑'],
      defaultId: 1,
      cancelId: 1,
      title: '未保存的修改',
      message: '当前文件有未保存的修改，关闭将丢失这些内容。',
    };
    void dialog.showMessageBox(window, options).then((result) => {
      if (result.response === 0 && !window.isDestroyed()) {
        this._closeConfirmedWindows.add(window.id);
        window.destroy();
      }
    });
  }

  private _createTransport(window: BrowserWindow): IMessageTransport {
    return {
      onMessage: (listener) => {
        const wrapped = (event: IpcMainEvent, message: unknown): void => {
          if (event.sender !== window.webContents) {
            this._logService.warn('已忽略来自未知渲染进程的 IPC 消息');
            return;
          }
          listener(message);
        };
        ipcMain.on(RPC_CHANNEL_NAME, wrapped);
        return toDisposable(() => {
          ipcMain.removeListener(RPC_CHANNEL_NAME, wrapped);
        });
      },
      send: (message) => {
        if (!window.isDestroyed()) {
          window.webContents.send(RPC_CHANNEL_NAME, message);
        }
      },
    };
  }
}
