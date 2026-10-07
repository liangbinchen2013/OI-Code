import type { Event, URI } from '@oi/base';
import { createDecorator } from './instantiation';

/** 评测支持的语言。 */
export type JudgeLanguage = 'cpp' | 'python';

/**
 * 单个测试点：输入与期望输出均以文本保存，支持粘贴或文件导入。
 */
export interface ITestCase {
  readonly name: string;
  readonly input: string;
  readonly expectedOutput: string;
}

/** 评测结果判定。 */
export type JudgeVerdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';

export interface IJudgeCaseResult {
  readonly name: string;
  readonly verdict: JudgeVerdict;
  /** 运行耗时（毫秒）。 */
  readonly timeMs?: number;
  /** 峰值内存（KB）。 */
  readonly memoryKb?: number;
  /** 程序标准输出（超限截断）。 */
  readonly stdout?: string;
  readonly stderr?: string;
  readonly message?: string;
}

export interface IJudgeRequest {
  /** 编辑器当前内容（可含未保存修改，无需先保存文件）。 */
  readonly content: string;
  readonly language: JudgeLanguage;
  readonly timeLimitMs: number;
  readonly memoryLimitMb: number;
  readonly cases: readonly ITestCase[];
}

export interface IJudgeResult {
  readonly compileOk: boolean;
  readonly compileMessage: string;
  readonly results: readonly IJudgeCaseResult[];
}

export interface IStressRequest {
  readonly generatorUri: URI;
  readonly referenceUri: URI;
  readonly solutionUri: URI;
  readonly iterations: number;
  readonly timeLimitMs: number;
}

export interface IStressProgress {
  readonly phase: 'compiling' | 'running' | 'finished';
  readonly iteration: number;
  readonly total: number;
}

export interface IStressResult {
  readonly ok: boolean;
  /** 通过（输出一致）的对拍轮数。 */
  readonly passed: number;
  readonly total: number;
  readonly failedIteration?: number;
  readonly input?: string;
  readonly referenceOutput?: string;
  readonly solutionOutput?: string;
  readonly message: string;
}

/**
 * 评测/对拍契约：编译在 Code 层实现，耗时操作必须异步并上报进度。
 * 进度事件只存在于渲染进程代理（{@link IJudgeServiceClient}）。
 */
export interface IJudgeService {
  /** 编译当前文件并按测试点评测，返回逐点判定。 */
  run(request: IJudgeRequest): Promise<IJudgeResult>;
  /** 对拍：生成器数据分别喂给标准程序与待测程序，逐轮比对输出。 */
  stress(
    request: IStressRequest,
    onProgress?: (progress: IStressProgress) => void,
  ): Promise<IStressResult>;
  /** 请求停止正在进行的对拍；当前轮结束后返回。 */
  cancelStress(): Promise<void>;
  /** 递归读取目录并配对同前缀的 .in/.out 等数据文件。 */
  importDirectory(uri: URI): Promise<readonly ITestCase[]>;
  /** 解压 zip 到临时目录并按前缀配对数据文件。 */
  importArchive(uri: URI): Promise<readonly ITestCase[]>;
}

/**
 * 渲染进程侧的评测服务：在 {@link IJudgeService} 之上暴露对拍进度事件。
 */
export interface IJudgeServiceClient extends IJudgeService {
  readonly onDidStressProgress: Event<IStressProgress>;
}

export const IJudgeService = createDecorator<IJudgeService>('judgeService');
