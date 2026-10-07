import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { toError } from '@oi/base';
import type { ILogService } from '@oi/platform';

/** 采样间隔（毫秒）。 */
const SAMPLE_INTERVAL_MS = 50;

export interface IMemoryWatcher {
  /** 目标进程峰值内存（KB）；无法测量时 undefined。 */
  readonly peakKb: Promise<number | undefined>;
  /** 是否曾超过内存限制。 */
  exceeded(): boolean;
  dispose(): void;
}

function windowsWatcherScript(pid: number, limitKb: number): string {
  return [
    `$target = ${pid}`,
    `$limit = ${limitKb}`,
    '$peak = 0',
    'while ($true) {',
    '  $p = Get-Process -Id $target -ErrorAction SilentlyContinue',
    '  if (-not $p) { break }',
    '  if ($p.PeakWorkingSet64 -gt $peak) { $peak = [int64]$p.PeakWorkingSet64 }',
    '  if ($limit -gt 0 -and $peak -gt ($limit * 1024)) { Write-Output "LIMIT"; exit }',
    `  Start-Sleep -Milliseconds ${SAMPLE_INTERVAL_MS}`,
    '}',
    'Write-Output ([int64]($peak / 1024))',
  ].join('\n');
}

async function sampleUnixKb(pid: number, logService: ILogService): Promise<number | undefined> {
  if (process.platform === 'linux') {
    try {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const match = /VmHWM:\s+(\d+)\s+kB/.exec(status);
      return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
    } catch (error) {
      logService.debug(`内存采样失败：pid=${pid}`, toError(error).message);
      return undefined;
    }
  }
  return new Promise<number | undefined>((resolve) => {
    const child = spawn('ps', ['-o', 'rss=', '-p', String(pid)], { windowsHide: true });
    let output = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      output += chunk;
    });
    child.once('error', (error) => {
      logService.debug(`内存采样失败：pid=${pid}`, toError(error).message);
      resolve(undefined);
    });
    child.once('close', () => {
      const value = Number.parseInt(output.trim(), 10);
      resolve(Number.isFinite(value) ? value : undefined);
    });
  });
}

/**
 * 监控指定进程的内存占用：超过 limitKb 时回调（调用方负责强杀并判 MLE）。
 * Windows 经 PowerShell 读取 PeakWorkingSet64；Linux 读 /proc VmHWM；macOS 用 ps。
 */
export function createMemoryWatcher(
  pid: number,
  limitKb: number | undefined,
  logService: ILogService,
  onExceed?: () => void,
): IMemoryWatcher {
  const limit = limitKb ?? 0;
  let exceeded = false;
  const markExceeded = (): void => {
    if (!exceeded) {
      exceeded = true;
      onExceed?.();
    }
  };

  if (process.platform === 'win32') {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', windowsWatcherScript(pid, limit)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let output = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      output += chunk;
      if (limit > 0 && output.includes('LIMIT')) {
        markExceeded();
      }
    });
    const peakKb = new Promise<number | undefined>((resolve) => {
      child.once('error', (error) => {
        logService.debug(`内存监控不可用：pid=${pid}`, toError(error).message);
        resolve(undefined);
      });
      child.once('close', () => {
        const text = output.replace('LIMIT', '').trim();
        const match = /\d+/.exec(text);
        resolve(match === null ? undefined : Number.parseInt(match[0], 10));
      });
    });
    return {
      peakKb,
      exceeded: () => exceeded,
      dispose: () => {
        child.kill();
      },
    };
  }

  let peak: number | undefined;
  let resolvePeak: ((value: number | undefined) => void) | undefined;
  const peakKb = new Promise<number | undefined>((resolve) => {
    resolvePeak = resolve;
  });
  const interval = setInterval(() => {
    void sampleUnixKb(pid, logService).then((kb) => {
      if (kb === undefined) {
        return;
      }
      peak = Math.max(peak ?? 0, kb);
      if (limit > 0 && peak > limit) {
        markExceeded();
      }
    });
  }, SAMPLE_INTERVAL_MS);
  return {
    peakKb,
    exceeded: () => exceeded,
    dispose: () => {
      clearInterval(interval);
      resolvePeak?.(peak);
    },
  };
}
