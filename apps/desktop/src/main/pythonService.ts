import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { toError } from '@oi/base';
import type { URI } from '@oi/base';
import {
  IConfigService,
  ILogService,
  IRunnerService,
  type ICodeDiagnostic,
  type IPipInstallRequest,
  type IPipInstallResult,
  type IPipOutputChunk,
  type IPythonInterpreter,
  type IPythonService,
  type IPythonStatus,
  type IRunResult,
  type ISearchProgress,
} from '@oi/platform';
import { CONFIG_KEYS } from './configKeys';
import { runProcess } from './processRunner';
import { compareVersions } from './toolchainService';

const PROBE_TIMEOUT_MS = 5_000;
const CHECK_TIMEOUT_MS = 10_000;
const PIP_TIMEOUT_MS = 600_000;

/** 清华 PyPI 镜像。 */
export const TSINGHUA_PYPI_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple';

const VERSION_PROBE_SCRIPT = 'import sys; print(sys.version.split()[0]); print(sys.executable)';

const SYNTAX_CHECK_SCRIPT = [
  'import json, sys',
  'source = sys.stdin.read()',
  'try:',
  '    compile(source, sys.argv[1], "exec")',
  'except SyntaxError as error:',
  '    payload = {',
  '        "line": error.lineno or 1,',
  '        "column": error.offset or 1,',
  '        "endLine": error.end_lineno or error.lineno or 1,',
  '        "endColumn": error.end_offset or error.offset or 1,',
  '        "message": error.msg or "语法错误",',
  '    }',
  '    print(json.dumps(payload))',
].join('\n');

/**
 * 解析 `py -0p` 输出中的解释器路径（路径可能含空格）。
 */
export function parsePyLauncherOutput(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /([A-Za-z]:\\.*\.exe)\s*$/.exec(line.trim());
    if (match?.[1] !== undefined) {
      paths.push(match[1]);
    }
  }
  return paths;
}

/**
 * 校验包名与版本（拒绝空值、前导符号与非法字符）。
 */
export function validatePackageSpec(request: IPipInstallRequest): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(request.packageName)) {
    return '包名只能包含字母、数字、点、下划线与连字符，且需以字母或数字开头';
  }
  if (request.version !== undefined && request.version.length > 0) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+!-]*$/.test(request.version)) {
      return '版本号含非法字符';
    }
  }
  return undefined;
}

/**
 * 构造 pip 安装参数（含可选的清华源与版本约束）。
 */
export function buildPipArguments(interpreterPath: string, request: IPipInstallRequest): string[] {
  const spec =
    request.version !== undefined && request.version.length > 0
      ? `${request.packageName}==${request.version}`
      : request.packageName;
  const args = [
    interpreterPath,
    '-m',
    'pip',
    'install',
    spec,
    '--disable-pip-version-check',
    '--no-input',
  ];
  if (request.useTsinghuaMirror) {
    args.push('-i', TSINGHUA_PYPI_INDEX);
  }
  return args;
}

export interface ISyntaxErrorPayload {
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 解析语法检查脚本的输出；无输出表示语法通过。
 */
export function parseSyntaxCheckOutput(output: string): ISyntaxErrorPayload | undefined {
  const lastLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .pop();
  if (lastLine === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { line, column, endLine, endColumn, message } = parsed;
  if (typeof line !== 'number' || typeof column !== 'number') {
    return undefined;
  }
  return {
    line,
    column,
    ...(typeof endLine === 'number' ? { endLine } : {}),
    ...(typeof endColumn === 'number' ? { endColumn } : {}),
    message: typeof message === 'string' ? message : '语法错误',
  };
}

/**
 * Python 工具链实现：解释器搜索（py 启动器 / PATH / 常见安装目录）、
 * pip 安装（版本约束 + 清华源 + 流式输出）与语法检查（编译真实源码，不执行）。
 */
export class PythonService implements IPythonService {
  private _autoSearch: Promise<void> | undefined;

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IConfigService private readonly _configService: IConfigService,
    @IRunnerService private readonly _runnerService: IRunnerService,
  ) {}

  async getStatus(): Promise<IPythonStatus> {
    const interpreters = await this._readCachedInterpreters();
    const existing = interpreters.filter((interpreter) => existsSync(interpreter.path));
    const defaultPath = await this._resolveInterpreterPath();
    return { interpreters: existing, ...(defaultPath === undefined ? {} : { defaultPath }) };
  }

  async search(onProgress?: (progress: ISearchProgress) => void): Promise<IPythonStatus> {
    onProgress?.({ phase: 'searching' });
    const candidates = await this._findCandidates();
    const interpreters: IPythonInterpreter[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      onProgress?.({ phase: 'probing', detail: candidate });
      const interpreter = await this._probeInterpreter(candidate);
      if (interpreter === undefined) {
        continue;
      }
      const key = interpreter.path.replace(/\//g, '\\').toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      interpreters.push(interpreter);
    }
    interpreters.sort((left, right) => compareVersions(right.version, left.version));

    const previousDefault = await this._configService.get(CONFIG_KEYS.pythonPath);
    const defaultPath =
      typeof previousDefault === 'string' &&
      interpreters.some((interpreter) => interpreter.path === previousDefault)
        ? previousDefault
        : interpreters[0]?.path;
    if (defaultPath !== undefined) {
      await this._configService.set(CONFIG_KEYS.pythonPath, defaultPath);
    }
    await this._configService.set(CONFIG_KEYS.pythonInterpreters, interpreters);
    onProgress?.({ phase: 'finished' });
    return { interpreters, ...(defaultPath === undefined ? {} : { defaultPath }) };
  }

  async setDefaultInterpreter(path: string): Promise<void> {
    if (!existsSync(path)) {
      throw new Error(`解释器不存在：${path}`);
    }
    await this._configService.set(CONFIG_KEYS.pythonPath, path);
  }

  async pipInstall(
    request: IPipInstallRequest,
    onOutput?: (chunk: IPipOutputChunk) => void,
  ): Promise<IPipInstallResult> {
    const validationError = validatePackageSpec(request);
    if (validationError !== undefined) {
      return { ok: false, exitCode: -1, message: validationError };
    }
    const interpreterPath = await this._ensureInterpreter(request.interpreterPath);
    if (interpreterPath === undefined) {
      return { ok: false, exitCode: -1, message: '未找到 Python 解释器，请先在设置中搜索' };
    }
    const args = buildPipArguments(interpreterPath, request);
    const result = await runProcess(args[0] ?? interpreterPath, args.slice(1), {
      timeoutMs: PIP_TIMEOUT_MS,
      env: this._pythonEnvironment(),
      onStdout: (chunk) => onOutput?.({ stream: 'stdout', chunk }),
      onStderr: (chunk) => onOutput?.({ stream: 'stderr', chunk }),
    });
    if (result.errorMessage !== undefined) {
      return { ok: false, exitCode: -1, message: `pip 无法启动：${result.errorMessage}` };
    }
    if (result.timedOut) {
      return { ok: false, exitCode: -1, message: 'pip 安装超时' };
    }
    const exitCode = result.exitCode ?? -1;
    return {
      ok: exitCode === 0,
      exitCode,
      message: exitCode === 0 ? '安装完成' : `安装失败（退出码 ${exitCode}）`,
    };
  }

  async run(uri: URI): Promise<IRunResult> {
    const interpreterPath = await this._ensureInterpreter();
    if (interpreterPath === undefined) {
      return { launched: false, message: '未找到 Python 解释器，请先在设置中搜索' };
    }
    if (uri.scheme !== 'file') {
      return { launched: false, message: '仅支持运行本地文件' };
    }
    return this._runnerService.run({
      command: interpreterPath,
      args: [uri.fsPath],
      workingDirectory: dirname(uri.fsPath),
      displayName: basename(uri.fsPath),
      pathPrepend: [dirname(interpreterPath)],
    });
  }

  async check(uri: URI, content: string): Promise<readonly ICodeDiagnostic[]> {
    const interpreterPath = await this._ensureInterpreter();
    if (interpreterPath === undefined || uri.scheme !== 'file') {
      return [];
    }
    const fileName = basename(uri.fsPath);
    const result = await runProcess(interpreterPath, ['-c', SYNTAX_CHECK_SCRIPT, fileName], {
      stdin: content,
      timeoutMs: CHECK_TIMEOUT_MS,
      env: this._pythonEnvironment(),
    });
    if (result.errorMessage !== undefined) {
      this._logService.warn(`Python 语法检查无法启动：${result.errorMessage}`);
      return [];
    }
    if (result.timedOut) {
      return [{ severity: 'error', message: '语法检查超时', line: 0, column: 0 }];
    }
    const payload = parseSyntaxCheckOutput(result.stdout);
    if (payload === undefined) {
      return [];
    }
    return [
      {
        severity: 'error',
        message: payload.message,
        line: payload.line,
        column: payload.column,
        ...(payload.endLine === undefined ? {} : { endLine: payload.endLine }),
        ...(payload.endColumn === undefined ? {} : { endColumn: payload.endColumn }),
        fileName,
        uri,
      },
    ];
  }

  private async _readCachedInterpreters(): Promise<IPythonInterpreter[]> {
    const cached = await this._configService.get(CONFIG_KEYS.pythonInterpreters);
    if (!Array.isArray(cached)) {
      return [];
    }
    return cached.flatMap((entry) => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { path?: unknown }).path === 'string' &&
        typeof (entry as { version?: unknown }).version === 'string' &&
        typeof (entry as { versionText?: unknown }).versionText === 'string'
      ) {
        const typed = entry as { path: string; version: string; versionText: string };
        return [{ path: typed.path, version: typed.version, versionText: typed.versionText }];
      }
      return [];
    });
  }

  /**
   * 取解释器路径；未配置时自动搜索一次（搜索无果也不重复尝试，设置页显式搜索仍可重试）。
   */
  private async _ensureInterpreter(preferred?: string): Promise<string | undefined> {
    const resolved = await this._resolveInterpreterPath(preferred);
    if (resolved !== undefined) {
      return resolved;
    }
    this._autoSearch ??= this._runAutoSearch();
    await this._autoSearch;
    return this._resolveInterpreterPath(preferred);
  }

  private async _runAutoSearch(): Promise<void> {
    try {
      await this.search();
    } catch (error) {
      this._autoSearch = undefined;
      this._logService.warn(`自动搜索 Python 解释器失败：${toError(error).message}`);
    }
  }

  private async _resolveInterpreterPath(preferred?: string): Promise<string | undefined> {
    if (preferred !== undefined && preferred.length > 0 && existsSync(preferred)) {
      return preferred;
    }
    const configured = await this._configService.get(CONFIG_KEYS.pythonPath);
    if (typeof configured === 'string' && existsSync(configured)) {
      return configured;
    }
    const cached = await this._readCachedInterpreters();
    return cached.find((interpreter) => existsSync(interpreter.path))?.path;
  }

  private async _findCandidates(): Promise<string[]> {
    const candidates: string[] = [];
    candidates.push(...(await this._findViaLauncher()));
    candidates.push(...(await this._findOnPath()));
    candidates.push(...this._commonCandidates());
    return candidates;
  }

  private async _findViaLauncher(): Promise<string[]> {
    const result = await runProcess(process.platform === 'win32' ? 'py.exe' : 'py', ['-0p'], {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      return [];
    }
    return parsePyLauncherOutput(result.stdout);
  }

  private async _findOnPath(): Promise<string[]> {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const paths: string[] = [];
    for (const name of ['python', 'python3']) {
      const result = await runProcess(command, [name], { timeoutMs: PROBE_TIMEOUT_MS });
      if (result.exitCode !== 0) {
        continue;
      }
      paths.push(
        ...result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    }
    return paths;
  }

  private _commonCandidates(): string[] {
    const candidates: string[] = [];
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData !== undefined) {
      candidates.push(...this._pythonExesIn(join(localAppData, 'Programs', 'Python')));
    }
    const systemDrive = process.env['SystemDrive'] ?? 'C:';
    candidates.push(...this._pythonExesIn(`${systemDrive}\\`));
    const home = process.env['USERPROFILE'];
    if (home !== undefined) {
      candidates.push(
        join(home, 'anaconda3', 'python.exe'),
        join(home, 'miniconda3', 'python.exe'),
        join(home, 'miniforge3', 'python.exe'),
      );
    }
    candidates.push(
      join(`${systemDrive}\\`, 'ProgramData', 'Anaconda3', 'python.exe'),
      join(`${systemDrive}\\`, 'ProgramData', 'miniconda3', 'python.exe'),
    );
    return candidates;
  }

  private _pythonExesIn(directory: string): string[] {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^Python\d/i.test(entry.name))
        .map((entry) => join(directory, entry.name, 'python.exe'))
        .filter((path) => existsSync(path));
    } catch (error) {
      this._logService.debug(`跳过解释器扫描目录：${directory}`, toError(error).message);
      return [];
    }
  }

  private async _probeInterpreter(candidate: string): Promise<IPythonInterpreter | undefined> {
    if (!existsSync(candidate)) {
      return undefined;
    }
    const result = await runProcess(candidate, ['-c', VERSION_PROBE_SCRIPT], {
      timeoutMs: PROBE_TIMEOUT_MS,
      env: this._pythonEnvironment(),
    });
    if (result.exitCode !== 0) {
      return undefined;
    }
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const version = lines[0];
    const executable = lines[1] ?? candidate;
    if (version === undefined) {
      return undefined;
    }
    return { path: executable, version, versionText: `Python ${version}` };
  }

  private _pythonEnvironment(): NodeJS.ProcessEnv {
    return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  }
}
