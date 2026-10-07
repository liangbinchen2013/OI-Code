import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { toError } from '@oi/base';

/** 强力搜索默认最大递归深度：过深目录收益低且显著拖慢扫描。 */
export const FORCE_SEARCH_MAX_DEPTH = 8;

/**
 * 强力搜索跳过的目录名（小写匹配）：系统目录、包管理器缓存等。
 */
export const FORCE_SEARCH_SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  'windows',
  '$recycle.bin',
  'system volume information',
  'recovery',
  'perflogs',
  'node_modules',
  '.git',
  '.cache',
  'cache',
  'temp',
  'tmp',
  '__pycache__',
  'site-packages',
]);

function canonical(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * 去除被其他根目录包含的根（避免重复扫描），保留原始大小写。
 */
export function dedupeRoots(roots: readonly string[]): string[] {
  const entries = roots
    .filter((root) => root.trim().length > 0)
    .map((root) => ({ original: root, key: canonical(root) }))
    .sort((left, right) => left.key.length - right.key.length);
  const kept: { original: string; key: string }[] = [];
  for (const entry of entries) {
    const subsumed = kept.some(
      (parent) =>
        entry.key === parent.key ||
        entry.key.startsWith(parent.key.endsWith(sep) ? parent.key : `${parent.key}${sep}`),
    );
    if (!subsumed) {
      kept.push(entry);
    }
  }
  return kept.map((entry) => entry.original);
}

/**
 * 强力搜索默认根目录：Windows 为全部固定盘符 + 用户目录等；
 * 其他平台为 /usr、/opt、/home 等常见位置。测试可经 OI_FORCE_SEARCH_ROOTS 覆盖。
 */
export function defaultSearchRoots(): string[] {
  const override = process.env['OI_FORCE_SEARCH_ROOTS'];
  if (override !== undefined && override.trim().length > 0) {
    return dedupeRoots(override.split(';'));
  }
  if (process.platform === 'win32') {
    const roots: string[] = [];
    for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) {
        roots.push(drive);
      }
    }
    for (const key of ['USERPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']) {
      const value = process.env[key];
      if (value !== undefined && value.length > 0 && existsSync(value)) {
        roots.push(value);
      }
    }
    return dedupeRoots(roots);
  }
  return dedupeRoots(['/usr', '/opt', '/home', '/usr/local'].filter((root) => existsSync(root)));
}

export interface IFindFilesRequest {
  readonly roots: readonly string[];
  /** 目标文件名（小写匹配，如 `g++.exe`）。 */
  readonly fileNames: ReadonlySet<string>;
  readonly maxDepth?: number;
  /** 进入某目录前回调，用于进度上报（可能高频触发，调用方自行节流）。 */
  readonly onDirectory?: (directory: string) => void;
  /** 目录读取失败回调（权限不足等）；缺省忽略该目录。 */
  readonly onError?: (directory: string, error: Error) => void;
}

export function shouldSkipDirectory(name: string): boolean {
  return FORCE_SEARCH_SKIP_DIRECTORIES.has(name.toLowerCase());
}

/**
 * 广度优先递归查找文件；不跟随符号链接目录，按深度上限剪枝。
 */
export async function findFiles(request: IFindFilesRequest): Promise<string[]> {
  const maxDepth = request.maxDepth ?? FORCE_SEARCH_MAX_DEPTH;
  const queue = request.roots.map((directory) => ({ directory, depth: 0 }));
  const results: string[] = [];
  const seenDirectories = new Set<string>();
  let index = 0;
  while (index < queue.length) {
    const current = queue[index];
    index += 1;
    if (current === undefined) {
      continue;
    }
    const key = canonical(current.directory);
    if (seenDirectories.has(key)) {
      continue;
    }
    seenDirectories.add(key);
    request.onDirectory?.(current.directory);
    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch (error) {
      request.onError?.(current.directory, toError(error));
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          entry.isSymbolicLink() ||
          current.depth >= maxDepth ||
          shouldSkipDirectory(entry.name)
        ) {
          continue;
        }
        queue.push({ directory: join(current.directory, entry.name), depth: current.depth + 1 });
      } else if (entry.isFile() && request.fileNames.has(entry.name.toLowerCase())) {
        results.push(join(current.directory, entry.name));
      }
    }
  }
  return results;
}
