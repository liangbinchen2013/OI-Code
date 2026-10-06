import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IPreloadIpcApi } from '@oi/platform';
import { RPC_CHANNEL_NAME } from '../common/ipc';

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
};

contextBridge.exposeInMainWorld('oiCode', api);
