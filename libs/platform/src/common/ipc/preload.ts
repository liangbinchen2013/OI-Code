/**
 * preload 经 contextBridge 暴露给渲染进程的最小 IPC 面：
 * 渲染进程只接触消息收发，不接触任何 Node.js API。
 */
export interface IPreloadIpcApi {
  readonly ipc: {
    send(message: unknown): void;
    onMessage(listener: (message: unknown) => void): () => void;
  };
}
