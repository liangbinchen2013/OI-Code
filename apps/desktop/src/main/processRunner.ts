import { spawn } from 'node:child_process';
import { toError } from '@oi/base';

export interface IProcessRunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** 超时后强杀进程树；缺省不限制。 */
  readonly timeoutMs?: number;
  /** 写入子进程 stdin 后关闭。 */
  readonly stdin?: string;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
}

export interface IProcessRunResult {
  /** 无法启动时为 null。 */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** 启动失败（如命令不存在）时的原因。 */
  readonly errorMessage?: string;
}

/**
 * 将目录前置到 PATH 环境变量（大小写不敏感地识别 Windows 的 `Path`）。
 */
export function withPrependedPath(
  environment: NodeJS.ProcessEnv,
  prepend: readonly string[],
  separator: string,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...environment };
  if (prepend.length === 0) {
    return result;
  }
  const existingKey = Object.keys(result).find((key) => key.toLowerCase() === 'path');
  const existingValue = existingKey === undefined ? undefined : result[existingKey];
  const segments = [...prepend, ...(existingValue ? [existingValue] : [])];
  result[existingKey ?? 'PATH'] = segments.join(separator);
  return result;
}

/**
 * 运行外部进程并收集输出：命令与参数分离、不经 shell，Windows 下隐藏窗口。
 * 超时或调用方进程退出时强杀整个进程树（taskkill），避免残留。
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: IProcessRunOptions = {},
): Promise<IProcessRunResult> {
  return new Promise<IProcessRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      windowsHide: true,
      stdio: 'pipe',
    });

    const settle = (result: IProcessRunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      resolve(result);
    };

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

    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killTree();
      }, options.timeoutMs);
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });

    child.once('error', (error) => {
      settle({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        errorMessage: toError(error).message,
      });
    });

    child.once('close', (code) => {
      settle({ exitCode: code, stdout, stderr, timedOut });
    });

    if (child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.stdin ?? '');
    }
  });
}
