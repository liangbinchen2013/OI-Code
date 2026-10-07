import { onUnexpectedError } from '@oi/base';
import type {
  IPythonServiceClient,
  IPythonStatus,
  IToolchainServiceClient,
  IToolchainStatus,
} from '@oi/platform';

/** 环境自检覆盖的工具链语言。 */
export type EnvironmentLanguage = 'cpp' | 'python';

/** 单条官方下载指引。 */
export interface IDownloadLink {
  /** 链接文案。 */
  readonly label: string;
  /** 下载地址。 */
  readonly url: string;
}

/** 单种工具链的检出结果。 */
export interface ILanguageResult {
  /** 是否已部署（检出可用版本）。 */
  readonly found: boolean;
  /** 检出的版本说明，服务未上报时缺省。 */
  readonly version?: string;
}

/** 首次启动环境自检的整体结果。 */
export interface IEnvironmentState {
  readonly cpp: ILanguageResult;
  readonly python: ILanguageResult;
}

/** 自检进度胶囊的展示信息。 */
export interface IEnvironmentProgress {
  /** 当前扫描 / 探测目标，来自工具链服务的进度通知。 */
  readonly detail?: string;
  /** 是否处于全盘强力搜索阶段。 */
  readonly force: boolean;
  /** 当前正在搜索的语言。 */
  readonly language: EnvironmentLanguage;
}

/** 单轮搜索的身份：语言 + 是否全盘强力搜索。 */
export interface ISearchRound {
  /** 是否为全盘强力搜索轮。 */
  readonly force: boolean;
  /** 本轮搜索的语言。 */
  readonly language: EnvironmentLanguage;
}

/**
 * 自检需要注入的服务集合：只依赖状态查询与两类搜索，
 * 编译 / 运行 / 检查等能力不参与首次自检。
 */
export interface IEnvironmentBootstrapServices {
  readonly pythonService: Pick<IPythonServiceClient, 'getStatus' | 'search' | 'forceSearch'>;
  readonly toolchainService: Pick<IToolchainServiceClient, 'getStatus' | 'search' | 'forceSearch'>;
}

/** {@link runEnvironmentBootstrap} 的入参。 */
export interface IRunEnvironmentBootstrapOptions {
  /** 是否允许在缺失时自动执行全盘强力搜索。 */
  readonly allowForceSearch: boolean;
  /**
   * 每轮搜索开始前回调。搜索进度由服务的 `onDidSearchProgress` 事件独立上报，
   * 需要据此判断当前进度属于哪种语言、哪个阶段。
   */
  readonly onRoundStart?: (round: ISearchRound) => void;
  readonly services: IEnvironmentBootstrapServices;
}

/** C++ 编译器官方下载指引。 */
export const CPP_DOWNLOAD_LINKS: readonly IDownloadLink[] = [
  { label: 'MSYS2（推荐，含 g++ 一键安装）', url: 'https://www.msys2.org/' },
  { label: 'MinGW-w64 发布页（离线安装包）', url: 'https://mingwpe.github.io/' },
  { label: 'WinLibs（免安装压缩包）', url: 'https://winlibs.com/' },
];

/** Python 解释器官方下载指引。 */
export const PYTHON_DOWNLOAD_LINKS: readonly IDownloadLink[] = [
  { label: 'python.org 官方下载', url: 'https://www.python.org/downloads/' },
  { label: '华为镜像（国内加速下载）', url: 'https://mirrors.huaweicloud.com/python/' },
];

const ENV_BOOTSTRAP_DONE_KEY = 'oi-code.environment-bootstrap.done';

/** 取指定语言的官方下载指引。 */
export function downloadLinksOf(language: EnvironmentLanguage): readonly IDownloadLink[] {
  return language === 'cpp' ? CPP_DOWNLOAD_LINKS : PYTHON_DOWNLOAD_LINKS;
}

/** 工具链状态是否表示 C++ 编译器已就绪。 */
export function cppReady(status: IToolchainStatus): boolean {
  return status.found && status.compilerPath !== undefined;
}

/** 工具链状态是否表示 Python 解释器已就绪。 */
export function pythonReady(status: IPythonStatus): boolean {
  return status.interpreters.length > 0;
}

/** 本机是否已执行过首次自动检测；未完成时下次启动仍会补检。 */
export function hasRunEnvironmentBootstrap(): boolean {
  try {
    return window.localStorage.getItem(ENV_BOOTSTRAP_DONE_KEY) === 'true';
  } catch (error) {
    onUnexpectedError(error);
    return false;
  }
}

/** 写入一次性标记，避免每次启动重复自检。 */
export function markEnvironmentBootstrapDone(): void {
  try {
    window.localStorage.setItem(ENV_BOOTSTRAP_DONE_KEY, 'true');
  } catch (error) {
    onUnexpectedError(error);
  }
}

/**
 * 首次启动环境自动配置：先读缓存状态，未配置的语言先简单搜索，
 * 仍缺失且策略允许时再执行全盘强力搜索；结束后返回各语言检出结果。
 */
export async function runEnvironmentBootstrap(
  options: IRunEnvironmentBootstrapOptions,
): Promise<IEnvironmentState> {
  const { services } = options;
  let cppStatus = await services.toolchainService.getStatus();
  let pythonStatus = await services.pythonService.getStatus();
  const search = async (round: ISearchRound): Promise<void> => {
    options.onRoundStart?.(round);
    if (round.language === 'cpp') {
      cppStatus = round.force
        ? await services.toolchainService.forceSearch()
        : await services.toolchainService.search();
    } else {
      pythonStatus = round.force
        ? await services.pythonService.forceSearch()
        : await services.pythonService.search();
    }
  };
  if (!cppReady(cppStatus)) {
    await search({ force: false, language: 'cpp' });
  }
  if (!pythonReady(pythonStatus)) {
    await search({ force: false, language: 'python' });
  }
  if (options.allowForceSearch) {
    if (!cppReady(cppStatus)) {
      await search({ force: true, language: 'cpp' });
    }
    if (!pythonReady(pythonStatus)) {
      await search({ force: true, language: 'python' });
    }
  }
  return {
    cpp: {
      found: cppReady(cppStatus),
      ...(cppStatus.compilerVersion === undefined ? {} : { version: cppStatus.compilerVersion }),
    },
    python: {
      found: pythonReady(pythonStatus),
      ...(pythonStatus.defaultPath === undefined
        ? {}
        : {
            version: pythonStatus.interpreters.find(
              (interpreter) => interpreter.path === pythonStatus.defaultPath,
            )?.version,
          }),
    },
  };
}
