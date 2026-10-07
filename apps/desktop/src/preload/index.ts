import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IPreloadEnvironment, IPreloadIpcApi } from '@oi/platform';
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
};

contextBridge.exposeInMainWorld('oiCode', api);
