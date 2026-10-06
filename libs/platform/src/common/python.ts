import type { Event, URI } from '@oi/base';
import type { ICodeDiagnostic } from './diagnostics';
import { createDecorator } from './instantiation';
import type { IRunResult } from './runner';
import type { ISearchProgress } from './toolchain';

/**
 * 单个 Python 解释器。
 */
export interface IPythonInterpreter {
  readonly path: string;
  /** 纯版本号，如 `3.13.12`。 */
  readonly version: string;
  /** 原始版本文本，如 `Python 3.13.12`。 */
  readonly versionText: string;
}

export interface IPythonStatus {
  readonly interpreters: readonly IPythonInterpreter[];
  readonly defaultPath?: string;
}

export interface IPipInstallRequest {
  readonly packageName: string;
  /** 指定版本时等价于 `包名==版本`。 */
  readonly version?: string;
  readonly useTsinghuaMirror: boolean;
  /** 指定安装到哪个解释器；缺省用默认解释器。 */
  readonly interpreterPath?: string;
}

export interface IPipInstallResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly message: string;
}

export interface IPipOutputChunk {
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
}

/**
 * Python 工具链契约：解释器搜索、pip 安装（可走清华源）、运行与实时语法检查。
 * 进度/输出事件只存在于渲染进程代理（{@link IPythonServiceClient}）。
 */
export interface IPythonService {
  getStatus(): Promise<IPythonStatus>;
  /** 全量搜索解释器；主进程实现可经回调上报进度。 */
  search(onProgress?: (progress: ISearchProgress) => void): Promise<IPythonStatus>;
  setDefaultInterpreter(path: string): Promise<void>;
  /** 执行 pip 安装；主进程实现可经回调流式上报输出。 */
  pipInstall(
    request: IPipInstallRequest,
    onOutput?: (chunk: IPipOutputChunk) => void,
  ): Promise<IPipInstallResult>;
  run(uri: URI): Promise<IRunResult>;
  /** 实时语法检查：仅做语法编译，不执行用户代码。 */
  check(uri: URI, content: string): Promise<readonly ICodeDiagnostic[]>;
}

/**
 * 渲染进程侧的 Python 工具链服务：暴露搜索进度与 pip 流式输出事件。
 */
export interface IPythonServiceClient extends IPythonService {
  readonly onDidSearchProgress: Event<ISearchProgress>;
  readonly onDidPipOutput: Event<IPipOutputChunk>;
}

export const IPythonService = createDecorator<IPythonService>('pythonService');
