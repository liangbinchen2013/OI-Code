import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { URI, toError } from '@oi/base';
import {
  ILogService,
  IPythonService,
  IToolchainService,
  TEST_DATA_INPUT_SUFFIXES,
  TEST_DATA_OUTPUT_SUFFIXES,
  pairTestData,
  type ITestCase,
  type ITestDataEntry,
  type IJudgeCaseResult,
  type IJudgeRequest,
  type IJudgeResult,
  type IJudgeService,
  type IStressProgress,
  type IStressRequest,
  type IStressResult,
} from '@oi/platform';
import { createMemoryWatcher, type IMemoryWatcher } from './memoryWatcher';
import { runProcess } from './processRunner';

/** 单次运行捕获上限（字符数），避免巨量输出拖垮主进程。 */
const MAX_CAPTURE_CHARS = 256 * 1024;
/** 导入数据文件大小上限。 */
const MAX_DATA_FILE_BYTES = 4 * 1024 * 1024;
/** 目录递归深度上限。 */
const MAX_DATA_DEPTH = 6;
/** 超时判定宽限：实际强杀时间 = 限制 + 该值，超出限制即判 TLE。 */
const TIME_LIMIT_GRACE_MS = 200;
const RUNTIME_SOURCE_EXTENSIONS = new Set(['.cpp', '.cc', '.cxx', '.c']);
const ZIP_EXTENSION = '.zip';

export interface IProgramRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly exceededMemory: boolean;
  readonly timeMs: number;
  readonly memoryKb?: number;
  readonly errorMessage?: string;
}

function truncate(text: string): string {
  return text.length > MAX_CAPTURE_CHARS
    ? `${text.slice(0, MAX_CAPTURE_CHARS)}\n…（输出过长已截断）`
    : text;
}

/**
 * 输出比对归一化：统一换行、忽略行尾空白与文件末尾多余空行。
 */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '');
}

function dataFileSuffix(path: string): string | undefined {
  const extension = extname(path).slice(1).toLowerCase();
  return extension.length > 0 ? extension : undefined;
}

/**
 * 评测/对拍实现：编译复用工具链服务，进程按测试点运行并采集时间与峰值内存。
 * zip 解压只依赖系统工具（Windows Expand-Archive / Unix unzip）。
 */
export class JudgeService implements IJudgeService {
  private _stressCancelled = false;

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IToolchainService private readonly _toolchainService: IToolchainService,
    @IPythonService private readonly _pythonService: IPythonService,
  ) {}

  async run(request: IJudgeRequest): Promise<IJudgeResult> {
    const directory = await mkdtemp(join(tmpdir(), 'oi-code-judge-'));
    try {
      const prepared = await this._prepareProgram(
        URI.file(join(directory, request.language === 'cpp' ? 'main.cpp' : 'main.py')),
        request.content,
        request.language,
      );
      if (typeof prepared === 'string') {
        return {
          compileOk: false,
          compileMessage: prepared,
          results: request.cases.map((testCase) => ({
            name: testCase.name,
            verdict: 'CE' as const,
            message: prepared,
          })),
        };
      }
      const results: IJudgeCaseResult[] = [];
      for (const testCase of request.cases) {
        const outcome = await this._runProgram(prepared.command, prepared.args, {
          cwd: directory,
          stdin: testCase.input,
          timeLimitMs: request.timeLimitMs,
          memoryLimitKb: request.memoryLimitMb > 0 ? request.memoryLimitMb * 1024 : undefined,
          ...(prepared.env === undefined ? {} : { env: prepared.env }),
        });
        results.push(this._toCaseResult(testCase, outcome, request.timeLimitMs));
      }
      return { compileOk: true, compileMessage: '编译成功', results };
    } catch (error) {
      const message = toError(error).message;
      return {
        compileOk: false,
        compileMessage: message,
        results: request.cases.map((testCase) => ({
          name: testCase.name,
          verdict: 'CE' as const,
          message,
        })),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async stress(
    request: IStressRequest,
    onProgress?: (progress: IStressProgress) => void,
  ): Promise<IStressResult> {
    this._stressCancelled = false;
    const total = request.iterations;
    const directory = await mkdtemp(join(tmpdir(), 'oi-code-stress-'));
    try {
      onProgress?.({ phase: 'compiling', iteration: 0, total });
      let programs: {
        generator: IPreparedProgram;
        reference: IPreparedProgram;
        solution: IPreparedProgram;
      };
      try {
        programs = {
          generator: await this._prepareFileProgram(request.generatorUri, 'generator', directory),
          reference: await this._prepareFileProgram(request.referenceUri, 'reference', directory),
          solution: await this._prepareFileProgram(request.solutionUri, 'solution', directory),
        };
      } catch (error) {
        return { ok: false, passed: 0, total, message: toError(error).message };
      }

      for (let iteration = 1; iteration <= total; iteration += 1) {
        if (this._stressCancelled) {
          return { ok: false, passed: iteration - 1, total, message: '已手动停止' };
        }
        onProgress?.({ phase: 'running', iteration, total });
        const generated = await this._runProgram(
          programs.generator.command,
          programs.generator.args,
          {
            cwd: directory,
            stdin: '',
            timeLimitMs: request.timeLimitMs,
            ...(programs.generator.env === undefined ? {} : { env: programs.generator.env }),
          },
        );
        if (
          generated.exitCode !== 0 ||
          generated.timedOut ||
          generated.errorMessage !== undefined
        ) {
          return {
            ok: false,
            passed: iteration - 1,
            total,
            message: `数据生成器运行失败：${generated.errorMessage ?? generated.stderr.trim()}`,
          };
        }
        const input = generated.stdout;
        const reference = await this._runProgram(
          programs.reference.command,
          programs.reference.args,
          {
            cwd: directory,
            stdin: input,
            timeLimitMs: request.timeLimitMs,
            ...(programs.reference.env === undefined ? {} : { env: programs.reference.env }),
          },
        );
        const solution = await this._runProgram(programs.solution.command, programs.solution.args, {
          cwd: directory,
          stdin: input,
          timeLimitMs: request.timeLimitMs,
          ...(programs.solution.env === undefined ? {} : { env: programs.solution.env }),
        });
        if (
          reference.exitCode !== 0 ||
          reference.timedOut ||
          reference.errorMessage !== undefined
        ) {
          return {
            ok: false,
            passed: iteration - 1,
            total,
            message: `标准程序运行失败：${reference.errorMessage ?? reference.stderr.trim()}`,
          };
        }
        if (solution.exceededMemory) {
          return {
            ok: false,
            passed: iteration - 1,
            total,
            failedIteration: iteration,
            input: truncate(input),
            referenceOutput: truncate(reference.stdout),
            solutionOutput: truncate(solution.stdout),
            message: `第 ${iteration} 次：待测程序内存超限`,
          };
        }
        if (solution.timedOut) {
          return {
            ok: false,
            passed: iteration - 1,
            total,
            failedIteration: iteration,
            input: truncate(input),
            referenceOutput: truncate(reference.stdout),
            solutionOutput: truncate(solution.stdout),
            message: `第 ${iteration} 次：待测程序超时`,
          };
        }
        if (solution.exitCode !== 0 || solution.errorMessage !== undefined) {
          return {
            ok: false,
            passed: iteration - 1,
            total,
            failedIteration: iteration,
            input: truncate(input),
            referenceOutput: truncate(reference.stdout),
            solutionOutput: truncate(solution.stderr.trim() || solution.stdout),
            message: `第 ${iteration} 次：待测程序运行错误`,
          };
        }
        if (normalizeOutput(reference.stdout) !== normalizeOutput(solution.stdout)) {
          return {
            ok: false,
            passed: iteration - 1,
            total,
            failedIteration: iteration,
            input: truncate(input),
            referenceOutput: truncate(reference.stdout),
            solutionOutput: truncate(solution.stdout),
            message: `第 ${iteration} 次发现输出不一致`,
          };
        }
      }
      onProgress?.({ phase: 'finished', iteration: total, total });
      return { ok: true, passed: total, total, message: `对拍通过 ${total} 次` };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async cancelStress(): Promise<void> {
    this._stressCancelled = true;
  }

  async importDirectory(uri: URI): Promise<readonly ITestCase[]> {
    const entries = await this._readDataFiles(uri.fsPath, 0);
    return pairTestData(entries);
  }

  async importArchive(uri: URI): Promise<readonly ITestCase[]> {
    if (extname(uri.fsPath).toLowerCase() !== ZIP_EXTENSION) {
      throw new Error('仅支持 .zip 压缩包');
    }
    const directory = await mkdtemp(join(tmpdir(), 'oi-code-archive-'));
    try {
      await this._extractZip(uri.fsPath, directory);
      const entries = await this._readDataFiles(directory, 0);
      return pairTestData(entries);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private _toCaseResult(
    testCase: ITestCase,
    outcome: IProgramRunResult,
    timeLimitMs: number,
  ): IJudgeCaseResult {
    const base = {
      name: testCase.name,
      timeMs: outcome.timeMs,
      ...(outcome.memoryKb === undefined ? {} : { memoryKb: outcome.memoryKb }),
      stdout: truncate(outcome.stdout),
      stderr: truncate(outcome.stderr),
    };
    if (outcome.errorMessage !== undefined) {
      return { ...base, verdict: 'RE', message: outcome.errorMessage };
    }
    if (outcome.exceededMemory) {
      return { ...base, verdict: 'MLE', message: '内存超限' };
    }
    if (outcome.timedOut || outcome.timeMs > timeLimitMs) {
      return { ...base, verdict: 'TLE', message: `超出时间限制（${timeLimitMs}ms）` };
    }
    if (outcome.exitCode !== 0) {
      return {
        ...base,
        verdict: 'RE',
        message: outcome.stderr.trim() || `退出码 ${outcome.exitCode}`,
      };
    }
    if (normalizeOutput(outcome.stdout) === normalizeOutput(testCase.expectedOutput)) {
      return { ...base, verdict: 'AC' };
    }
    return { ...base, verdict: 'WA', message: '输出与期望不一致' };
  }

  /**
   * 以字符串内容准备程序：C++ 编译为可执行文件，Python 使用默认解释器。
   * 失败时返回错误信息字符串。
   */
  private async _prepareProgram(
    uri: URI,
    content: string,
    language: 'cpp' | 'python',
  ): Promise<IPreparedProgram | string> {
    await writeFile(uri.fsPath, content, 'utf8');
    if (language === 'python') {
      const interpreter = await this._pythonService.resolveInterpreterPath();
      if (interpreter === undefined) {
        return '未找到 Python 解释器，请先在设置中搜索';
      }
      return { command: interpreter, args: [uri.fsPath], env: pythonEnvironment() };
    }
    const result = await this._toolchainService.compile({ uri, content });
    if (!result.ok || result.executablePath === undefined) {
      return `编译失败：${result.message}`;
    }
    return { command: result.executablePath, args: [] };
  }

  /** 以磁盘文件准备程序（对拍三件套），失败时抛错。 */
  private async _prepareFileProgram(
    uri: URI,
    name: string,
    directory: string,
  ): Promise<IPreparedProgram> {
    const extension = extname(uri.fsPath).toLowerCase();
    if (extension === '.py') {
      const interpreter = await this._pythonService.resolveInterpreterPath();
      if (interpreter === undefined) {
        throw new Error(`未找到 Python 解释器，无法运行 ${basename(uri.fsPath)}`);
      }
      return { command: interpreter, args: [uri.fsPath], env: pythonEnvironment() };
    }
    if (!RUNTIME_SOURCE_EXTENSIONS.has(extension)) {
      throw new Error(`不支持的文件类型：${basename(uri.fsPath)}（仅支持 C++ / Python）`);
    }
    const content = await readFile(uri.fsPath, 'utf8');
    const sourcePath = join(directory, `${name}.cpp`);
    await writeFile(sourcePath, content, 'utf8');
    const result = await this._toolchainService.compile({
      uri: URI.file(sourcePath),
      content,
    });
    if (!result.ok || result.executablePath === undefined) {
      throw new Error(`${basename(uri.fsPath)} 编译失败：${result.message}`);
    }
    return { command: result.executablePath, args: [] };
  }

  /** 运行程序并按限制强杀；返回输出、耗时与峰值内存。 */
  private _runProgram(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly stdin: string;
      readonly timeLimitMs: number;
      readonly memoryLimitKb?: number;
      readonly env?: NodeJS.ProcessEnv;
    },
  ): Promise<IProgramRunResult> {
    return new Promise<IProgramRunResult>((resolve) => {
      const startedAt = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(command, [...args], {
        cwd: options.cwd,
        windowsHide: true,
        stdio: 'pipe',
        ...(options.env === undefined ? {} : { env: options.env }),
      });

      const killTree = (): void => {
        if (child.pid === undefined) {
          return;
        }
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).once(
            'error',
            () => undefined,
          );
        } else {
          child.kill('SIGKILL');
        }
      };

      const timeoutHandle = setTimeout(
        () => {
          timedOut = true;
          killTree();
        },
        Math.max(1, options.timeLimitMs) + TIME_LIMIT_GRACE_MS,
      );

      const watcher: IMemoryWatcher | undefined =
        child.pid === undefined
          ? undefined
          : createMemoryWatcher(child.pid, options.memoryLimitKb, this._logService, killTree);

      const finish = (exitCode: number | null, errorMessage?: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        watcher?.dispose();
        const peakPromise = watcher?.peakKb ?? Promise.resolve(undefined);
        void Promise.race([
          peakPromise,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 800)),
        ]).then((memoryKb) => {
          resolve({
            exitCode,
            stdout,
            stderr,
            timedOut,
            exceededMemory: watcher?.exceeded() ?? false,
            timeMs: Date.now() - startedAt,
            ...(memoryKb === undefined ? {} : { memoryKb }),
            ...(errorMessage === undefined ? {} : { errorMessage }),
          });
        });
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length < MAX_CAPTURE_CHARS) {
          stdout += chunk;
        }
      });
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < MAX_CAPTURE_CHARS) {
          stderr += chunk;
        }
      });
      child.once('error', (error) => finish(null, toError(error).message));
      child.once('close', (code) => finish(code));
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.stdin);
    });
  }

  private async _readDataFiles(directory: string, depth: number): Promise<ITestDataEntry[]> {
    if (depth > MAX_DATA_DEPTH) {
      return [];
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      this._logService.warn(`测试数据目录读取失败：${directory}`, toError(error).message);
      return [];
    }
    const results: ITestDataEntry[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this._readDataFiles(path, depth + 1)));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const suffix = dataFileSuffix(entry.name);
      if (
        suffix === undefined ||
        (!TEST_DATA_INPUT_SUFFIXES.includes(suffix) && !TEST_DATA_OUTPUT_SUFFIXES.includes(suffix))
      ) {
        continue;
      }
      try {
        const content = await readFile(path, 'utf8');
        if (content.length * 2 <= MAX_DATA_FILE_BYTES) {
          results.push({ path, content });
        }
      } catch (error) {
        this._logService.debug(`跳过无法读取的数据文件：${path}`, toError(error).message);
      }
    }
    return results;
  }

  private async _extractZip(zipPath: string, destination: string): Promise<void> {
    if (process.platform === 'win32') {
      const script = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`;
      const result = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeoutMs: 60_000 },
      );
      if (result.exitCode !== 0) {
        throw new Error(`压缩包解压失败：${result.stderr.trim() || `退出码 ${result.exitCode}`}`);
      }
      return;
    }
    const result = await runProcess('unzip', ['-o', zipPath, '-d', destination], {
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`压缩包解压失败：${result.stderr.trim() || '请确认系统已安装 unzip'}`);
    }
  }
}

interface IPreparedProgram {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

function pythonEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
}
