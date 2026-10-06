import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileAccessGuard } from './fileAccessGuard';

describe('FileAccessGuard', () => {
  let root: string;
  let nested: string;
  let sibling: string;
  let file: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'oi-code-guard-'));
    nested = join(root, 'a', 'b');
    sibling = `${root}-sibling`;
    file = join(root, 'a', 'main.cpp');
    mkdirSync(nested, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(file, '');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sibling, { recursive: true, force: true });
  });

  it('未授权路径一律拒绝', () => {
    const guard = new FileAccessGuard();
    expect(guard.isAllowed(file)).toBe(false);
  });

  it('allowPath 仅授权单个文件', () => {
    const guard = new FileAccessGuard();
    guard.allowPath(file);

    expect(guard.isAllowed(file)).toBe(true);
    expect(guard.isAllowed(join(root, 'a', 'other.cpp'))).toBe(false);
  });

  it('allowDirectory 授权整个子树', () => {
    const guard = new FileAccessGuard();
    guard.allowDirectory(root);

    expect(guard.isAllowed(join(root, 'a'))).toBe(true);
    expect(guard.isAllowed(file)).toBe(true);
    expect(guard.isAllowed(nested)).toBe(true);
  });

  it('目录授权不匹配同前缀的兄弟路径', () => {
    const guard = new FileAccessGuard();
    guard.allowDirectory(root);

    expect(guard.isAllowed(join(sibling, 'x.cpp'))).toBe(false);
  });

  it('Windows 下路径大小写不敏感', () => {
    if (process.platform !== 'win32') {
      return;
    }
    const guard = new FileAccessGuard();
    guard.allowDirectory(root);

    expect(guard.isAllowed(join(root, 'a').toUpperCase())).toBe(true);
  });
});
