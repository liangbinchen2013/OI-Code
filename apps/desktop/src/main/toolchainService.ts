import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { URI, toError } from '@oi/base';
import {
  IConfigService,
  ILogService,
  IRunnerService,
  type ICodeDiagnostic,
  type ICompileRequest,
  type ICompileResult,
  type IRunResult,
  type ISearchProgress,
  type IToolchainCandidate,
  type IToolchainService,
  type IToolchainStatus,
  type ToolchainCandidateSource,
} from '@oi/platform';
import { CONFIG_KEYS } from './configKeys';
import { parseCppDiagnostics, type IMapSourceFileResult } from './cppDiagnostics';
import { defaultSearchRoots, findFiles } from './fileSearch';
import { runProcess, withPrependedPath } from './processRunner';

const VERSION_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
const CHECK_TIMEOUT_MS = 10_000;
const COMPILE_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTICS = 100;
const PROBE_SOURCE = 'int main() { return 0; }\n';
const MAX_CUSTOM_FLAGS_LENGTH = 2000;
/** 强力搜索进度上报的最小间隔，避免 IPC 消息过密。 */
const SCAN_DETAIL_INTERVAL_MS = 150;

const BASE_STANDARDS = ['c++98', 'c++03', 'c++11', 'c++14', 'c++17', 'c++20', 'c++23'];
const FIRST_FUTURE_STANDARD_YEAR = 26;
const FUTURE_STANDARD_CANDIDATES = 10;

/**
 * 生成标准候选序列：c++98 起的已知标准，其后按 +3 年递增，
 * 供“逐个编译直到报错”的未来兼容探测。
 */
export function generateStandardCandidates(): string[] {
  const candidates = [...BASE_STANDARDS];
  for (let index = 0; index < FUTURE_STANDARD_CANDIDATES; index += 1) {
    candidates.push(`c++${FIRST_FUTURE_STANDARD_YEAR + index * 3}`);
  }
  return candidates;
}

/**
 * 从 `g++ --version` 首行提取版本号（如 `16.1.0`）。
 */
export function parseGppVersion(versionOutput: string): string | undefined {
  const firstLine = versionOutput.split(/\r?\n/, 1)[0] ?? '';
  const matches = [...firstLine.matchAll(/(\d+)\.(\d+)(?:\.(\d+))?/g)];
  const last = matches[matches.length - 1];
  if (last === undefined) {
    return undefined;
  }
  return [last[1], last[2], last[3]].filter((part): part is string => part !== undefined).join('.');
}

/**
 * 仅比较数字段，返回 left - right。
 */
export function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * 解析自定义编译选项：空格分隔，支持单/双引号包裹含空格的片段。
 */
export function parseCompileFlags(input: string): string[] {
  const flags: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (const character of input) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        flags.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) {
    flags.push(current);
  }
  return flags;
}

function comparePathKeys(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

function normalizeForCompare(path: string): string {
  return resolve(path).replace(/\//g, '\\').toLowerCase();
}

function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * 源文件对应的可执行文件路径（Windows 为同名 .exe，其余平台去扩展名）。
 */
export function executablePathFor(sourcePath: string): string {
  const extension = extname(sourcePath);
  const base = extension.length > 0 ? sourcePath.slice(0, -extension.length) : sourcePath;
  return process.platform === 'win32' ? `${base}.exe` : base;
}

async function findGppOnPath(): Promise<string[]> {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runProcess(command, ['g++'], { timeoutMs: VERSION_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function commonGppCandidates(): string[] {
  const systemDrive = process.env['SystemDrive'] ?? 'C:';
  const programFiles = process.env['ProgramFiles'] ?? `${systemDrive}\\Program Files`;
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? `${systemDrive}\\Program Files (x86)`;
  const localAppData = process.env['LOCALAPPDATA'];
  const home = process.env['USERPROFILE'];
  const candidates = [
    join(`${systemDrive}\\`, 'msys64', 'ucrt64', 'bin', 'g++.exe'),
    join(`${systemDrive}\\`, 'msys64', 'mingw64', 'bin', 'g++.exe'),
    join(programFiles, 'mingw64', 'bin', 'g++.exe'),
    join(programFilesX86, 'Dev-Cpp', 'MinGW64', 'bin', 'g++.exe'),
    join(`${systemDrive}\\`, 'MinGW', 'bin', 'g++.exe'),
    join(`${systemDrive}\\`, 'mingw64', 'bin', 'g++.exe'),
    join(`${systemDrive}\\`, 'ProgramData', 'chocolatey', 'bin', 'g++.exe'),
  ];
  if (localAppData !== undefined) {
    candidates.push(join(localAppData, 'Microsoft', 'WinGet', 'Links', 'g++.exe'));
  }
  if (home !== undefined) {
    candidates.push(join(home, 'scoop', 'apps', 'gcc', 'current', 'bin', 'g++.exe'));
  }
  return candidates;
}

function gppExecutableName(): string {
  return process.platform === 'win32' ? 'g++.exe' : 'g++';
}

/**
 * 归类常规定位候选的来源：MSYS2 / MinGW / 其它视为 PATH 系。
 */
export function classifyKnownSource(path: string): ToolchainCandidateSource {
  const lower = path.toLowerCase();
  if (lower.includes('msys')) {
    return 'msys2';
  }
  if (lower.includes('mingw') || lower.includes('dev-cpp')) {
    return 'mingw';
  }
  return 'path';
}

const CANDIDATE_SOURCES: ReadonlySet<ToolchainCandidateSource> = new Set([
  'path',
  'msys2',
  'mingw',
  'global',
]);

/**
 * 校验持久化的候选列表；结构不符的条目直接丢弃。
 */
export function parseCandidates(value: unknown): IToolchainCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const { path, version, source } = entry as {
      path?: unknown;
      version?: unknown;
      source?: unknown;
    };
    if (typeof path !== 'string' || typeof version !== 'string') {
      return [];
    }
    if (typeof source !== 'string' || !CANDIDATE_SOURCES.has(source as ToolchainCandidateSource)) {
      return [];
    }
    return [{ path, version, source: source as ToolchainCandidateSource }];
  });
}

/**
 * g++ 工具链实现：候选去重 → 版本探测 → 标准逐个探测 → 配置持久化。
 * 支持常规定位与全盘强力搜索；多候选可由用户选择默认编译器。
 * 编译走同目录临时源文件，不覆盖用户文件；可执行文件与源文件同目录同名。
 */
export class ToolchainService implements IToolchainService {
  private _autoSearch: Promise<void> | undefined;

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IConfigService private readonly _configService: IConfigService,
    @IRunnerService private readonly _runnerService: IRunnerService,
  ) {}

  async getStatus(): Promise<IToolchainStatus> {
    const compilerPath = await this._configService.get(CONFIG_KEYS.gppPath);
    if (typeof compilerPath !== 'string' || !existsSync(compilerPath)) {
      return { found: false, supportedStandards: [] };
    }
    const compilerVersion = await this._configService.get(CONFIG_KEYS.gppVersion);
    const cachedStandards = await this._configService.get(CONFIG_KEYS.cppStandards);
    const supportedStandards = Array.isArray(cachedStandards)
      ? cachedStandards.filter((value): value is string => typeof value === 'string')
      : [];
    const defaultStandard = await this._configService.get(CONFIG_KEYS.cppStandard);
    const customFlags = await this._configService.get(CONFIG_KEYS.cppCustomFlags);
    const candidates = parseCandidates(await this._configService.get(CONFIG_KEYS.cppCandidates));
    return {
      found: true,
      compilerPath,
      ...(typeof compilerVersion === 'string' ? { compilerVersion } : {}),
      supportedStandards,
      ...(typeof defaultStandard === 'string' ? { defaultStandard } : {}),
      ...(typeof customFlags === 'string' && customFlags.length > 0 ? { customFlags } : {}),
      ...(candidates.length > 0 ? { candidates } : {}),
    };
  }

  async search(onProgress?: (progress: ISearchProgress) => void): Promise<IToolchainStatus> {
    onProgress?.({ phase: 'searching' });
    const candidates = await this._collectCandidates(false, onProgress);
    return this._applySearchResult(candidates, onProgress);
  }

  async forceSearch(onProgress?: (progress: ISearchProgress) => void): Promise<IToolchainStatus> {
    onProgress?.({ phase: 'searching', detail: '正在扫描磁盘…' });
    const candidates = await this._collectCandidates(true, onProgress);
    return this._applySearchResult(candidates, onProgress);
  }

  async setDefaultCompiler(path: string): Promise<IToolchainStatus> {
    if (!isAbsolutePath(path) || !existsSync(path)) {
      throw new Error(`编译器不存在：${path}`);
    }
    const version = await this._probeVersion(path);
    if (version === undefined) {
      throw new Error(`无法识别的 g++ 编译器：${path}`);
    }
    const supportedStandards = await this._detectStandards(path);
    const defaultStandard = await this._chooseDefaultStandard(supportedStandards);
    await this._configService.set(CONFIG_KEYS.gppPath, path);
    await this._configService.set(CONFIG_KEYS.gppVersion, version);
    await this._configService.set(CONFIG_KEYS.cppStandards, supportedStandards);
    await this._configService.set(CONFIG_KEYS.cppStandard, defaultStandard);
    return this.getStatus();
  }

  async setDefaultStandard(standard: string): Promise<void> {
    if (!/^c\+\+\d{2,4}$/.test(standard)) {
      throw new Error(`非法的 C++ 标准：${standard}`);
    }
    await this._configService.set(CONFIG_KEYS.cppStandard, standard);
  }

  async setCustomFlags(flags: string): Promise<void> {
    if (flags.length > MAX_CUSTOM_FLAGS_LENGTH) {
      throw new Error(`自定义编译选项过长（上限 ${MAX_CUSTOM_FLAGS_LENGTH} 字符）`);
    }
    if (/[\r\n]/.test(flags)) {
      throw new Error('自定义编译选项不能包含换行');
    }
    await this._configService.set(CONFIG_KEYS.cppCustomFlags, flags.trim());
  }

  async compile(request: ICompileRequest): Promise<ICompileResult> {
    const compilerPath = await this._ensureCompiler();
    if (compilerPath === undefined) {
      return {
        ok: false,
        durationMs: 0,
        diagnostics: [],
        message: '未找到 g++ 编译器，请先在设置中搜索',
      };
    }
    if (request.uri.scheme !== 'file') {
      return { ok: false, durationMs: 0, diagnostics: [], message: '仅支持编译本地文件' };
    }
    const status = await this.getStatus();

    const sourcePath = request.uri.fsPath;
    const directory = dirname(sourcePath);
    const extension = extname(sourcePath);
    const base = extension.length > 0 ? basename(sourcePath, extension) : basename(sourcePath);
    const temporarySource = join(directory, `${base}.oi-code-tmp.cpp`);
    const executablePath = executablePathFor(sourcePath);
    const standard = request.standard ?? status.defaultStandard ?? 'c++17';
    const customFlags = parseCompileFlags(status.customFlags ?? '');
    const startedAt = Date.now();

    try {
      await writeFile(temporarySource, request.content, 'utf8');
      const result = await runProcess(
        compilerPath,
        [
          `-std=${standard}`,
          '-O2',
          '-Wall',
          '-fdiagnostics-color=never',
          ...customFlags,
          '-o',
          executablePath,
          temporarySource,
        ],
        {
          cwd: directory,
          timeoutMs: COMPILE_TIMEOUT_MS,
          env: this._compilerEnvironment(compilerPath),
        },
      );
      const diagnostics = parseCppDiagnostics(`${result.stdout}${result.stderr}`, {
        maxDiagnostics: MAX_DIAGNOSTICS,
        mapSourceFile: this._temporarySourceMapper(temporarySource, sourcePath, request.uri),
      });
      if (result.timedOut) {
        diagnostics.unshift({
          severity: 'error',
          message: `编译超时（超过 ${COMPILE_TIMEOUT_MS / 1000} 秒）`,
          line: 0,
          column: 0,
        });
      }
      const ok = result.exitCode === 0 && !result.timedOut;
      return {
        ok,
        ...(ok ? { executablePath } : {}),
        durationMs: Date.now() - startedAt,
        diagnostics,
        message: ok ? '编译成功' : '编译失败',
      };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        diagnostics: [],
        message: `编译失败：${toError(error).message}`,
      };
    } finally {
      await this._removeTemporarySource(temporarySource);
    }
  }

  async check(uri: URI, content: string): Promise<readonly ICodeDiagnostic[]> {
    const compilerPath = await this._ensureCompiler();
    if (compilerPath === undefined || uri.scheme !== 'file') {
      return [];
    }
    const status = await this.getStatus();
    const standard = status.defaultStandard ?? 'c++17';
    const customFlags = parseCompileFlags(status.customFlags ?? '');
    const result = await runProcess(
      compilerPath,
      [
        `-std=${standard}`,
        '-Wall',
        '-fdiagnostics-color=never',
        ...customFlags,
        '-fsyntax-only',
        '-x',
        'c++',
        '-',
      ],
      {
        cwd: dirname(uri.fsPath),
        stdin: content,
        timeoutMs: CHECK_TIMEOUT_MS,
        env: this._compilerEnvironment(compilerPath),
      },
    );
    if (result.errorMessage !== undefined) {
      this._logService.warn(`语法检查无法启动：${result.errorMessage}`);
      return [];
    }
    if (result.timedOut) {
      return [{ severity: 'error', message: '语法检查超时', line: 0, column: 0 }];
    }
    const fileName = basename(uri.fsPath);
    const directory = dirname(uri.fsPath);
    return parseCppDiagnostics(`${result.stdout}${result.stderr}`, {
      maxDiagnostics: MAX_DIAGNOSTICS,
      mapSourceFile: (file): IMapSourceFileResult => {
        const trimmed = file.trim();
        if (trimmed === '<stdin>' || trimmed === '-' || trimmed.length === 0) {
          return { fileName, uri };
        }
        const absolute = isAbsolutePath(trimmed) ? trimmed : join(directory, trimmed);
        return { fileName: basename(trimmed), uri: URI.file(absolute) };
      },
    });
  }

  async run(uri: URI): Promise<IRunResult> {
    const status = await this.getStatus();
    const executablePath = executablePathFor(uri.fsPath);
    if (!existsSync(executablePath)) {
      return { launched: false, message: '未找到可执行文件，请先编译' };
    }
    return this._runnerService.run({
      command: executablePath,
      args: [],
      workingDirectory: dirname(uri.fsPath),
      displayName: basename(executablePath),
      ...(status.compilerPath === undefined ? {} : { pathPrepend: [dirname(status.compilerPath)] }),
    });
  }

  /**
   * 取编译器路径；未配置时自动搜索一次（搜索无果也不重复尝试，设置页显式搜索仍可重试）。
   */
  private async _ensureCompiler(): Promise<string | undefined> {
    const status = await this.getStatus();
    if (status.found && status.compilerPath !== undefined) {
      return status.compilerPath;
    }
    this._autoSearch ??= this._runAutoSearch();
    await this._autoSearch;
    const refreshed = await this.getStatus();
    return refreshed.found ? refreshed.compilerPath : undefined;
  }

  private async _runAutoSearch(): Promise<void> {
    try {
      await this.search();
    } catch (error) {
      this._autoSearch = undefined;
      this._logService.warn(`自动搜索 g++ 失败：${toError(error).message}`);
    }
  }

  /**
   * 收集编译器候选：PATH 与常见安装位置，可选全盘强力扫描；
   * 逐个探测版本并按版本降序排列。
   */
  private async _collectCandidates(
    includeGlobal: boolean,
    onProgress?: (progress: ISearchProgress) => void,
  ): Promise<IToolchainCandidate[]> {
    const entries: { path: string; source: ToolchainCandidateSource }[] = [];
    const seen = new Set<string>();
    const push = (path: string, source: ToolchainCandidateSource): void => {
      const key = normalizeForCompare(path);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ path, source });
      }
    };
    for (const path of await findGppOnPath()) {
      push(path, 'path');
    }
    for (const path of commonGppCandidates()) {
      push(path, classifyKnownSource(path));
    }
    if (includeGlobal) {
      let lastReportedAt = 0;
      const globalPaths = await findFiles({
        roots: defaultSearchRoots(),
        fileNames: new Set([gppExecutableName()]),
        onDirectory: (directory) => {
          const now = Date.now();
          if (now - lastReportedAt >= SCAN_DETAIL_INTERVAL_MS) {
            lastReportedAt = now;
            onProgress?.({ phase: 'searching', detail: directory });
          }
        },
        onError: (directory, error) => {
          this._logService.debug(`强力搜索跳过目录：${directory}`, error.message);
        },
      });
      for (const path of globalPaths) {
        push(path, 'global');
      }
    }

    const candidates: IToolchainCandidate[] = [];
    const probed = new Set<string>();
    for (const entry of entries) {
      if (!existsSync(entry.path)) {
        continue;
      }
      const key = normalizeForCompare(entry.path);
      if (probed.has(key)) {
        continue;
      }
      probed.add(key);
      onProgress?.({ phase: 'probing', detail: entry.path });
      const version = await this._probeVersion(entry.path);
      if (version !== undefined) {
        candidates.push({ path: entry.path, version, source: entry.source });
      }
    }
    candidates.sort(
      (left, right) =>
        compareVersions(right.version, left.version) || left.path.localeCompare(right.path),
    );
    return candidates;
  }

  /**
   * 搜索结果落地：保留用户已选编译器（仍可用时），否则取版本最高者；
   * 实测默认编译器支持的标准后持久化。
   */
  private async _applySearchResult(
    candidates: readonly IToolchainCandidate[],
    onProgress?: (progress: ISearchProgress) => void,
  ): Promise<IToolchainStatus> {
    const compiler = await this._chooseCompiler(candidates);
    if (compiler === undefined) {
      onProgress?.({ phase: 'finished' });
      return { found: false, supportedStandards: [] };
    }
    const supportedStandards = await this._detectStandards(compiler.path, onProgress);
    const defaultStandard = await this._chooseDefaultStandard(supportedStandards);
    await this._configService.set(CONFIG_KEYS.gppPath, compiler.path);
    await this._configService.set(CONFIG_KEYS.gppVersion, compiler.version);
    await this._configService.set(CONFIG_KEYS.cppStandards, supportedStandards);
    await this._configService.set(CONFIG_KEYS.cppStandard, defaultStandard);
    await this._configService.set(CONFIG_KEYS.cppCandidates, candidates);
    onProgress?.({ phase: 'finished' });
    return {
      found: true,
      compilerPath: compiler.path,
      compilerVersion: compiler.version,
      supportedStandards,
      defaultStandard,
      candidates,
    };
  }

  private async _chooseCompiler(
    candidates: readonly IToolchainCandidate[],
  ): Promise<IToolchainCandidate | undefined> {
    const configured = await this._configService.get(CONFIG_KEYS.gppPath);
    if (typeof configured === 'string') {
      const match = candidates.find(
        (candidate) => normalizeForCompare(candidate.path) === normalizeForCompare(configured),
      );
      if (match !== undefined) {
        return match;
      }
    }
    return candidates[0];
  }

  private async _probeVersion(path: string): Promise<string | undefined> {
    const result = await runProcess(path, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      return undefined;
    }
    return parseGppVersion(result.stdout);
  }

  private async _detectStandards(
    compilerPath: string,
    onProgress?: (progress: ISearchProgress) => void,
  ): Promise<string[]> {
    const supported: string[] = [];
    for (const standard of generateStandardCandidates()) {
      onProgress?.({ phase: 'probing', detail: standard.toUpperCase() });
      const result = await runProcess(
        compilerPath,
        [`-std=${standard}`, '-fsyntax-only', '-x', 'c++', '-'],
        {
          stdin: PROBE_SOURCE,
          timeoutMs: PROBE_TIMEOUT_MS,
          env: this._compilerEnvironment(compilerPath),
        },
      );
      if (result.exitCode !== 0) {
        break;
      }
      supported.push(standard);
    }
    return supported;
  }

  private async _chooseDefaultStandard(standards: readonly string[]): Promise<string> {
    const existing = await this._configService.get(CONFIG_KEYS.cppStandard);
    if (typeof existing === 'string' && standards.includes(existing)) {
      return existing;
    }
    return standards[standards.length - 1] ?? 'c++17';
  }

  private _compilerEnvironment(compilerPath: string): NodeJS.ProcessEnv {
    return withPrependedPath(
      process.env,
      [dirname(compilerPath)],
      process.platform === 'win32' ? ';' : ':',
    );
  }

  private _temporarySourceMapper(
    temporarySource: string,
    sourcePath: string,
    sourceUri: URI,
  ): (fileName: string) => IMapSourceFileResult {
    const sourceName = basename(sourcePath);
    const directory = dirname(sourcePath);
    return (fileName: string): IMapSourceFileResult => {
      if (comparePathKeys(fileName, temporarySource)) {
        return { fileName: sourceName, uri: sourceUri };
      }
      const absolute = isAbsolutePath(fileName) ? fileName : join(directory, fileName);
      return { fileName: basename(fileName), uri: URI.file(absolute) };
    };
  }

  private async _removeTemporarySource(temporaryPath: string): Promise<void> {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        this._logService.warn(`临时源文件清理失败：${temporaryPath}`);
      }
    }
  }
}
