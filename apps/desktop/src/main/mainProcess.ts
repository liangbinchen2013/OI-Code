import { join } from 'node:path';
import { BrowserWindow, Menu, app, dialog, ipcMain, type IpcMainEvent } from 'electron';
import { DisposableStore, type IDisposable, URI, onUnexpectedError, toDisposable } from '@oi/base';
import {
  APP_RPC_ERROR_CODES,
  DIALOG_RPC_METHODS,
  FILE_RPC_METHODS,
  IFileDialogService,
  IFileService,
  ILogService,
  JSON_RPC_ERROR_CODES,
  RpcChannel,
  RpcError,
  WINDOW_RPC_NOTIFICATIONS,
  type IMessageTransport,
  type IOpenFileDialogOptions,
  type ISaveFileDialogOptions,
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

function parseDirtyParam(params: unknown): boolean | undefined {
  if (typeof params !== 'object' || params === null || !('dirty' in params)) {
    return undefined;
  }
  const { dirty } = params as { dirty: unknown };
  return typeof dirty === 'boolean' ? dirty : undefined;
}

/**
 * 主进程：窗口生命周期、IPC 服务端与文件访问授权。
 */
export class MainProcess implements IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _fileAccess = new FileAccessGuard();
  private readonly _dirtyWindows = new Map<number, boolean>();
  private readonly _closeConfirmedWindows = new Set<number>();

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IFileService private readonly _fileService: IFileService,
    @IFileDialogService private readonly _fileDialogService: IFileDialogService,
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
      },
    });
    window.once('ready-to-show', () => {
      window.show();
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

    const devServerUrl = process.env['OI_CODE_DEV_SERVER_URL'];
    if (devServerUrl) {
      void window.loadURL(devServerUrl);
    } else {
      void window.loadFile(join(__dirname, 'renderer', 'index.html'));
    }
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
