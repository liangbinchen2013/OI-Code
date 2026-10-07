import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dedupeRoots, findFiles, shouldSkipDirectory } from './fileSearch';

describe('dedupeRoots', () => {
  it('去除被父根包含的子根并保留原始写法', () => {
    const parent = join(tmpdir(), 'oi-roots');
    const child = join(parent, 'nested');
    const other = join(tmpdir(), 'oi-roots-other');
    const roots = dedupeRoots([parent, child, other, parent]);

    expect(roots).toContain(parent);
    expect(roots).toContain(other);
    expect(roots).not.toContain(child);
    expect(roots).toHaveLength(2);
  });
});

describe('shouldSkipDirectory', () => {
  it('大小写无关地跳过系统与缓存目录', () => {
    expect(shouldSkipDirectory('Windows')).toBe(true);
    expect(shouldSkipDirectory('NODE_MODULES')).toBe(true);
    expect(shouldSkipDirectory('bin')).toBe(false);
  });
});

describe('findFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oi-find-files-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('递归命中目标文件，跳过排除目录', async () => {
    await mkdir(join(root, 'bin', 'nested'), { recursive: true });
    await writeFile(join(root, 'bin', 'nested', 'g++.exe'), '', 'utf8');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'g++.exe'), '', 'utf8');

    const found = await findFiles({ roots: [root], fileNames: new Set(['g++.exe']) });

    expect(found).toEqual([join(root, 'bin', 'nested', 'g++.exe')]);
  });

  it('文件名大小写无关，深度超限时剪枝', async () => {
    await mkdir(join(root, 'level1', 'level2'), { recursive: true });
    await writeFile(join(root, 'level1', 'PYTHON.EXE'), '', 'utf8');
    await writeFile(join(root, 'level1', 'level2', 'python.exe'), '', 'utf8');

    const shallow = await findFiles({
      roots: [root],
      fileNames: new Set(['python.exe']),
      maxDepth: 1,
    });

    expect(shallow).toEqual([join(root, 'level1', 'PYTHON.EXE')]);
  });
});
