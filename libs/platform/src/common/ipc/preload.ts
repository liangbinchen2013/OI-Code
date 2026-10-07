/**
 * 首次启动环境自检的策略开关，由主进程计算后经 preload 透传。
 */
export interface IPreloadEnvironment {
  /**
   * 是否允许在自动检测中执行全盘强力搜索。
   * sandbox 下的 preload 读不到 process.env，打包态判定须由主进程经 additionalArguments 传入；
   * 未打包（开发/E2E）默认关闭，避免每次启动意外全盘扫描。
   */
  readonly allowAutoForceSearch: boolean;
  /** 跳过首次启动环境自检：既有 E2E 用例默认注入，避免自检弹窗干扰交互断言。 */
  readonly skipBootstrap: boolean;
}

/**
 * preload 经 contextBridge 暴露给渲染进程的最小 IPC 面：
 * 渲染进程只接触消息收发，不接触任何 Node.js API。
 */
export interface IPreloadIpcApi {
  readonly ipc: {
    send(message: unknown): void;
    onMessage(listener: (message: unknown) => void): () => void;
  };
  readonly environment: IPreloadEnvironment;
}
