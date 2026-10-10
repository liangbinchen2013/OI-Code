import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { IPreloadEnvironment, IPreloadIpcApi } from '@oi/platform';
import { JSON_RPC_VERSION, WINDOW_RPC_NOTIFICATIONS } from '@oi/platform';
import { RPC_CHANNEL_NAME } from '../common/ipc';

/** sandbox preload 无 process.env，启动策略由主进程经 additionalArguments 传入。 */
function readEnvironmentFlag(argumentName: string): boolean {
  const prefix = `--${argumentName}=`;
  const argument = process.argv.find((entry) => entry.startsWith(prefix));
  return argument?.slice(prefix.length) === 'true';
}

const environment: IPreloadEnvironment = {
  allowAutoForceSearch: readEnvironmentFlag('oi-allow-auto-force-search'),
  skipBootstrap: readEnvironmentFlag('oi-skip-env-bootstrap'),
};

const api: IPreloadIpcApi = {
  ipc: {
    send: (message: unknown): void => {
      ipcRenderer.send(RPC_CHANNEL_NAME, message);
    },
    onMessage: (listener: (message: unknown) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, message: unknown): void => {
        listener(message);
      };
      ipcRenderer.on(RPC_CHANNEL_NAME, wrapped);
      return () => {
        ipcRenderer.removeListener(RPC_CHANNEL_NAME, wrapped);
      };
    },
  },
  environment,
  files: {
    /**
     * 必须在拖放事件里同步调用：异步之后 File 句柄即失效。
     * 只有真实拖放才拿得到路径（JS 构造的 File 返回空串），
     * 所以顺手把它报给主进程加入文件白名单，等价于用户经对话框选中。
     */
    getPathForFile: (file) => {
      // 契约用结构最小集（platform 不依赖 DOM），这里还原成渲染进程传来的真实 File
      const path = webUtils.getPathForFile(file as File);
      if (path.length > 0) {
        ipcRenderer.send(RPC_CHANNEL_NAME, {
          jsonrpc: JSON_RPC_VERSION,
          method: WINDOW_RPC_NOTIFICATIONS.grantDroppedPaths,
          params: { paths: [path] },
        });
      }
      return path;
    },
  },
};

contextBridge.exposeInMainWorld('oiCode', api);
