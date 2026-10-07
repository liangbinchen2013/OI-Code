import type { IPythonStatus, IToolchainStatus } from '@oi/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cppReady,
  hasRunEnvironmentBootstrap,
  markEnvironmentBootstrapDone,
  pythonReady,
  runEnvironmentBootstrap,
  type IEnvironmentBootstrapServices,
  type ISearchRound,
} from './environmentBootstrap';

const foundCpp: IToolchainStatus = {
  compilerPath: 'C:/msys64/mingw64/bin/g++.exe',
  compilerVersion: 'g++ (GCC) 14.2.0',
  found: true,
  supportedStandards: ['c++14'],
};

const missingCpp: IToolchainStatus = { found: false, supportedStandards: [] };

const foundPython: IPythonStatus = {
  defaultPath: 'C:/Python312/python.exe',
  interpreters: [{ path: 'C:/Python312/python.exe', version: '3.12.4', versionText: '' }],
};

const missingPython: IPythonStatus = { interpreters: [] };

interface IFakeOptions {
  readonly cppAfterForce?: IToolchainStatus;
  readonly cppAfterSearch?: IToolchainStatus;
  readonly cppInitial: IToolchainStatus;
  readonly pythonAfterForce?: IPythonStatus;
  readonly pythonAfterSearch?: IPythonStatus;
  readonly pythonInitial: IPythonStatus;
}

/** 只实现自检用到的三个方法，类型由 IEnvironmentBootstrapServices 的 Pick 约束。 */
function createServices(options: IFakeOptions): IEnvironmentBootstrapServices {
  return {
    pythonService: {
      getStatus: vi.fn(async (): Promise<IPythonStatus> => options.pythonInitial),
      search: vi.fn(
        async (): Promise<IPythonStatus> => options.pythonAfterSearch ?? options.pythonInitial,
      ),
      forceSearch: vi.fn(
        async (): Promise<IPythonStatus> =>
          options.pythonAfterForce ?? options.pythonAfterSearch ?? options.pythonInitial,
      ),
    },
    toolchainService: {
      getStatus: vi.fn(async (): Promise<IToolchainStatus> => options.cppInitial),
      search: vi.fn(
        async (): Promise<IToolchainStatus> => options.cppAfterSearch ?? options.cppInitial,
      ),
      forceSearch: vi.fn(
        async (): Promise<IToolchainStatus> =>
          options.cppAfterForce ?? options.cppAfterSearch ?? options.cppInitial,
      ),
    },
  };
}

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
}

describe('environmentBootstrap 判定', () => {
  it('cppReady 要求 found 且有编译器路径', () => {
    expect(cppReady(foundCpp)).toBe(true);
    expect(cppReady(missingCpp)).toBe(false);
  });

  it('pythonReady 要求至少一个解释器', () => {
    expect(pythonReady(foundPython)).toBe(true);
    expect(pythonReady(missingPython)).toBe(false);
  });
});

describe('runEnvironmentBootstrap', () => {
  it('缓存已配置时不触发任何搜索', async () => {
    const services = createServices({ cppInitial: foundCpp, pythonInitial: foundPython });
    const rounds: ISearchRound[] = [];
    const state = await runEnvironmentBootstrap({
      allowForceSearch: true,
      onRoundStart: (round) => rounds.push(round),
      services,
    });
    expect(services.toolchainService.search).not.toHaveBeenCalled();
    expect(services.pythonService.forceSearch).not.toHaveBeenCalled();
    expect(rounds).toEqual([]);
    expect(state).toEqual({
      cpp: { found: true, version: 'g++ (GCC) 14.2.0' },
      python: { found: true, version: '3.12.4' },
    });
  });

  it('简单搜索命中即停，不执行强力搜索', async () => {
    const services = createServices({
      cppAfterSearch: foundCpp,
      cppInitial: missingCpp,
      pythonAfterSearch: foundPython,
      pythonInitial: missingPython,
    });
    const rounds: ISearchRound[] = [];
    const state = await runEnvironmentBootstrap({
      allowForceSearch: true,
      onRoundStart: (round) => rounds.push(round),
      services,
    });
    expect(services.toolchainService.forceSearch).not.toHaveBeenCalled();
    expect(services.pythonService.forceSearch).not.toHaveBeenCalled();
    expect(rounds).toEqual([
      { force: false, language: 'cpp' },
      { force: false, language: 'python' },
    ]);
    expect(state.cpp.found).toBe(true);
    expect(state.python.found).toBe(true);
  });

  it('简单搜索失败后按策略升级到强力搜索，且简单搜索先于强力搜索', async () => {
    const services = createServices({
      cppAfterForce: foundCpp,
      cppInitial: missingCpp,
      pythonInitial: missingPython,
    });
    const rounds: ISearchRound[] = [];
    const state = await runEnvironmentBootstrap({
      allowForceSearch: true,
      onRoundStart: (round) => rounds.push(round),
      services,
    });
    expect(services.toolchainService.forceSearch).toHaveBeenCalledTimes(1);
    expect(services.pythonService.forceSearch).toHaveBeenCalledTimes(1);
    expect(rounds).toEqual([
      { force: false, language: 'cpp' },
      { force: false, language: 'python' },
      { force: true, language: 'cpp' },
      { force: true, language: 'python' },
    ]);
    expect(state.cpp.found).toBe(true);
    expect(state.python.found).toBe(false);
  });

  it('策略禁止时绝不自动全盘扫描', async () => {
    const services = createServices({ cppInitial: missingCpp, pythonInitial: missingPython });
    const rounds: ISearchRound[] = [];
    const state = await runEnvironmentBootstrap({
      allowForceSearch: false,
      onRoundStart: (round) => rounds.push(round),
      services,
    });
    expect(services.toolchainService.forceSearch).not.toHaveBeenCalled();
    expect(services.pythonService.forceSearch).not.toHaveBeenCalled();
    expect(rounds.every((round) => !round.force)).toBe(true);
    expect(state.cpp.found).toBe(false);
  });
});

describe('一次性标记', () => {
  beforeEach(() => {
    stubLocalStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('首次为未运行，写入后为已运行', () => {
    expect(hasRunEnvironmentBootstrap()).toBe(false);
    markEnvironmentBootstrapDone();
    expect(hasRunEnvironmentBootstrap()).toBe(true);
  });
});
