import type { Event, URI } from '@oi/base';
import type { ICodeDiagnostic } from './diagnostics';
import { createDecorator } from './instantiation';
import type { IRunResult } from './runner';

/**
 * 工具链/解释器搜索进度：searching 表示枚举候选，probing 表示逐个验证。
 */
export interface ISearchProgress {
  readonly phase: 'searching' | 'probing' | 'finished';
  /** 当前探测目标，如 `C++23` 或候选路径。 */
  readonly detail?: string;
}

/** 编译器候选来源：PATH / MSYS2 / MinGW / 全局强力搜索。 */
export type ToolchainCandidateSource = 'path' | 'msys2' | 'mingw' | 'global';

/**
 * 单个 g++ 候选：路径、版本与发现来源。
 */
export interface IToolchainCandidate {
  readonly path: string;
  readonly version: string;
  readonly source: ToolchainCandidateSource;
}

/**
 * C++ 工具链状态：编译器位置、版本、实测支持的标准列表与全部候选。
 */
export interface IToolchainStatus {
  readonly found: boolean;
  readonly compilerPath?: string;
  readonly compilerVersion?: string;
  readonly supportedStandards: readonly string[];
  readonly defaultStandard?: string;
  /** 用户自定义编译选项原文（空格分隔，支持引号）。 */
  readonly customFlags?: string;
  /** 搜索发现的全部编译器候选（搜索后持久化）。 */
  readonly candidates?: readonly IToolchainCandidate[];
}

export interface ICompileRequest {
  readonly uri: URI;
  /** 编辑器当前内容（可含未保存修改）。 */
  readonly content: string;
  /** 覆盖默认标准；缺省用工具链的默认标准。 */
  readonly standard?: string;
}

export interface ICompileResult {
  readonly ok: boolean;
  readonly executablePath?: string;
  readonly durationMs: number;
  readonly diagnostics: readonly ICodeDiagnostic[];
  readonly message: string;
}

/**
 * C++ 工具链契约：搜索 g++、探测标准、编译、运行与实时语法检查。
 * 进度事件只存在于渲染进程代理（{@link IToolchainServiceClient}）；
 * 主进程实现通过回调上报，不实现事件成员。
 */
export interface IToolchainService {
  getStatus(): Promise<IToolchainStatus>;
  /** 全量搜索编译器并探测标准；主进程实现可经回调上报进度。 */
  search(onProgress?: (progress: ISearchProgress) => void): Promise<IToolchainStatus>;
  /** 强力搜索：递归扫描磁盘寻找 g++，耗时较长；结果并入候选列表。 */
  forceSearch(onProgress?: (progress: ISearchProgress) => void): Promise<IToolchainStatus>;
  /** 将指定候选设为默认编译器：立即实测其支持标准并持久化。 */
  setDefaultCompiler(path: string): Promise<IToolchainStatus>;
  setDefaultStandard(standard: string): Promise<void>;
  /** 保存自定义编译选项（空串表示清除）；参与编译与实时检查。 */
  setCustomFlags(flags: string): Promise<void>;
  compile(request: ICompileRequest): Promise<ICompileResult>;
  /** 运行已编译的可执行文件（源文件同目录同名 .exe）。 */
  run(uri: URI): Promise<IRunResult>;
  /** 实时语法检查：不落盘、不链接，仅产出诊断。 */
  check(uri: URI, content: string): Promise<readonly ICodeDiagnostic[]>;
}

/**
 * 渲染进程侧的 C++ 工具链服务：在 {@link IToolchainService} 之上暴露进度事件。
 */
export interface IToolchainServiceClient extends IToolchainService {
  readonly onDidSearchProgress: Event<ISearchProgress>;
}

export const IToolchainService = createDecorator<IToolchainService>('toolchainService');
