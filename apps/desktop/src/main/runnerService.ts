import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toError } from '@oi/base';
import {
  IConfigService,
  ILogService,
  type IRunnerRequest,
  type IRunResult,
  type IRunnerService,
} from '@oi/platform';
import { CONFIG_KEYS } from './configKeys';
import { OI_RUNNER_SOURCE } from './oiRunnerSource';
import { runProcess, withPrependedPath } from './processRunner';

export const OI_RUNNER_EXE_NAME = 'oi-runner.exe';

const RUNNER_SOURCE_FILE_NAME = 'oi-runner.cpp';
const RUNNER_COMPILE_TIMEOUT_MS = 120_000;

/**
 * 运行器实现：用检测到的 g++ 编译一次控制台包装器并缓存；
 * 每次运行在独立控制台窗口启动包装器，实时展示 CPU/内存统计。
 */
export class RunnerService implements IRunnerService {
  private _ensurePromise: Promise<string | undefined> | undefined;

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IConfigService private readonly _configService: IConfigService,
    private readonly _runnerDirectory: string,
  ) {}

  async run(request: IRunnerRequest): Promise<IRunResult> {
    const environment = withPrependedPath(
      process.env,
      request.pathPrepend ?? [],
      process.platform === 'win32' ? ';' : ':',
    );
    if (process.platform === 'win32') {
      const runnerPath = await this.ensureRunner();
      if (runnerPath !== undefined) {
        return this._spawnDetached(
          runnerPath,
          [request.displayName, request.command, ...request.args],
          request.workingDirectory,
          environment,
        );
      }
      this._logService.warn('OI 运行器不可用，退化为直接启动程序（无运行统计）');
    }
    return this._spawnDetached(
      request.command,
      request.args,
      request.workingDirectory,
      environment,
    );
  }

  /**
   * 预热运行器：必要时用 g++ 编译包装器；返回可执行路径，失败返回 undefined。
   */
  async ensureRunner(): Promise<string | undefined> {
    if (this._ensurePromise !== undefined) {
      return this._ensurePromise;
    }
    this._ensurePromise = this._doEnsureRunner();
    try {
      return await this._ensurePromise;
    } finally {
      this._ensurePromise = undefined;
    }
  }

  private async _doEnsureRunner(): Promise<string | undefined> {
    const sourceHash = createHash('sha256').update(OI_RUNNER_SOURCE).digest('hex');
    const runnerPath = join(this._runnerDirectory, OI_RUNNER_EXE_NAME);
    const cachedHash = await this._configService.get(CONFIG_KEYS.runnerHash);
    if (cachedHash === sourceHash && existsSync(runnerPath)) {
      return runnerPath;
    }
    const gppPath = await this._configService.get(CONFIG_KEYS.gppPath);
    if (typeof gppPath !== 'string' || gppPath.length === 0 || !existsSync(gppPath)) {
      this._logService.warn('未找到 g++，无法编译 OI 运行器');
      return undefined;
    }
    try {
      await mkdir(this._runnerDirectory, { recursive: true });
      const sourcePath = join(this._runnerDirectory, RUNNER_SOURCE_FILE_NAME);
      await writeFile(sourcePath, OI_RUNNER_SOURCE, 'utf8');
      const result = await runProcess(
        gppPath,
        ['-std=c++17', '-O2', '-municode', '-static', '-o', runnerPath, sourcePath, '-lpsapi'],
        { cwd: this._runnerDirectory, timeoutMs: RUNNER_COMPILE_TIMEOUT_MS },
      );
      if (result.exitCode !== 0) {
        this._logService.error(`OI 运行器编译失败：${result.stderr.trim()}`);
        return undefined;
      }
      await this._configService.set(CONFIG_KEYS.runnerHash, sourceHash);
      return runnerPath;
    } catch (error) {
      this._logService.error(`OI 运行器准备失败：${toError(error).message}`);
      return undefined;
    }
  }

  private _spawnDetached(
    command: string,
    args: readonly string[],
    workingDirectory: string,
    environment: NodeJS.ProcessEnv,
  ): Promise<IRunResult> {
    return new Promise<IRunResult>((resolve) => {
      let settled = false;
      const settle = (result: IRunResult): void => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      try {
        const child = spawn(command, [...args], {
          cwd: workingDirectory,
          env: environment,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.once('spawn', () => {
          child.unref();
          settle({ launched: true });
        });
        child.once('error', (error) => {
          settle({ launched: false, message: toError(error).message });
        });
      } catch (error) {
        settle({ launched: false, message: toError(error).message });
      }
    });
  }
}
