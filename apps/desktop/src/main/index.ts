import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, type IpcMainEvent } from 'electron';
import {
  type IDisposable,
  DisposableStore,
  onUnexpectedError,
  setUnexpectedErrorHandler,
  toDisposable,
  toError,
} from '@oi/base';
import {
  type IMessageTransport,
  ILogService,
  InstantiationService,
  LogService,
  RpcChannel,
  ServiceCollection,
} from '@oi/platform';
import { FileLogger } from '@oi/platform/node';
import { RPC_CHANNEL_NAME } from '../common/ipc';

const WINDOW_MIN_WIDTH = 720;

class MainProcess implements IDisposable {
  private readonly _disposables = new DisposableStore();

  constructor(@ILogService private readonly _logService: ILogService) {}

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
      backgroundColor: '#ffffff',
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

    const channel = new RpcChannel(this._createTransport(window));
    this._disposables.add(channel);
    channel.registerMethod('ping', () => ({ pong: true, pid: process.pid }));

    const devServerUrl = process.env['OI_CODE_DEV_SERVER_URL'];
    if (devServerUrl) {
      void window.loadURL(devServerUrl);
    } else {
      void window.loadFile(join(__dirname, 'renderer', 'index.html'));
    }
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

function main(): void {
  const logService = new LogService();
  setUnexpectedErrorHandler((error) => {
    logService.error(toError(error));
  });

  const services = new ServiceCollection();
  services.set(ILogService, logService);
  const instantiationService = new InstantiationService(services);
  const mainProcess = instantiationService.createInstance(MainProcess);

  app.on('will-quit', () => {
    mainProcess.dispose();
    instantiationService.dispose();
    logService.dispose();
  });

  mainProcess.start();
}

main();
