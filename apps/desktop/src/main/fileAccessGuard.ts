import { resolve } from 'node:path';

function normalizePath(path: string): string {
  const unified = resolve(path).replace(/\\/g, '/');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

/**
 * 文件访问白名单：只有用户经系统对话框主动选择过的路径才允许读写，
 * 防止渲染进程（或注入脚本）读写任意文件。
 */
export class FileAccessGuard {
  private readonly _allowed = new Set<string>();

  allow(fsPath: string): void {
    this._allowed.add(normalizePath(fsPath));
  }

  isAllowed(fsPath: string): boolean {
    return this._allowed.has(normalizePath(fsPath));
  }
}
