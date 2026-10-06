import { createDecorator } from './instantiation';

/**
 * 外部进程启动请求：命令与参数分离，不经 shell 拼接。
 */
export interface IRunnerRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  /** 控制台窗口标题与状态行显示的名字，如 `T1.exe`。 */
  readonly displayName: string;
  /** 追加到子进程 PATH 前缀的目录（如编译器 bin，保证运行时找得到 DLL）。 */
  readonly pathPrepend?: readonly string[];
}

export interface IRunResult {
  readonly launched: boolean;
  readonly message?: string;
}

/**
 * 运行器契约：在独立控制台窗口启动目标程序，附运行统计（平台实现决定能力）。
 */
export interface IRunnerService {
  run(request: IRunnerRequest): Promise<IRunResult>;
}

export const IRunnerService = createDecorator<IRunnerService>('runnerService');
