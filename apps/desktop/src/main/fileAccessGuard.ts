import { resolve } from 'node:path';

function normalizePath(path: string): string {
  const unified = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

/**
 * 文件访问白名单：只有用户经系统对话框主动选择的文件/文件夹才允许访问。
 * 授权文件夹后，其整个子树自动纳入白名单；路径比较按平台规范化。
 */
export class FileAccessGuard {
  private readonly _allowedPaths = new Set<string>();
  private readonly _allowedRoots = new Set<string>();

  allowPath(fsPath: string): void {
    this._allowedPaths.add(normalizePath(fsPath));
  }

  allowDirectory(fsPath: string): void {
    this._allowedRoots.add(normalizePath(fsPath));
  }

  isAllowed(fsPath: string): boolean {
    const normalized = normalizePath(fsPath);
    if (this._allowedPaths.has(normalized)) {
      return true;
    }
    for (const root of this._allowedRoots) {
      if (normalized === root || normalized.startsWith(`${root}/`)) {
        return true;
      }
    }
    return false;
  }
}
