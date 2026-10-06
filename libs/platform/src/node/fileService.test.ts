import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URI } from '@oi/base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileService } from './fileService';

describe('NodeFileService', () => {
  let directory: string;
  let service: NodeFileService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oi-code-fs-'));
    service = new NodeFileService();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('写入后读回同一内容', async () => {
    const uri = URI.file(join(directory, 'note.cpp'));

    await service.writeFile(uri, 'int main() { return 0; }\n');

    await expect(service.readFile(uri)).resolves.toBe('int main() { return 0; }\n');
  });

  it('exists 区分存在与不存在的文件', async () => {
    const existing = URI.file(join(directory, 'a.py'));
    await writeFile(existing.fsPath, 'print(1)\n', 'utf8');

    await expect(service.exists(existing)).resolves.toBe(true);
    await expect(service.exists(URI.file(join(directory, 'missing.py')))).resolves.toBe(false);
  });

  it('读取不存在的文件时以带路径的错误拒绝', async () => {
    const missing = URI.file(join(directory, 'nope.cpp'));

    await expect(service.readFile(missing)).rejects.toThrow(/读取文件失败：.*nope\.cpp/);
  });

  it('读取目录：目录优先、名称排序并给出完整 URI', async () => {
    await mkdir(join(directory, 'sub'));
    await writeFile(join(directory, 'b.cpp'), '', 'utf8');
    await writeFile(join(directory, 'a.py'), '', 'utf8');

    const entries = await service.readDirectory(URI.file(directory));

    expect(entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'directory:sub',
      'file:a.py',
      'file:b.cpp',
    ]);
    expect(entries[2]?.uri.toString()).toBe(URI.file(join(directory, 'b.cpp')).toString());
  });

  it('读取不存在的目录时以带路径的错误拒绝', async () => {
    await expect(service.readDirectory(URI.file(join(directory, 'missing-dir')))).rejects.toThrow(
      /读取目录失败/,
    );
  });

  it('拒绝非 file scheme 的 URI', async () => {
    const remote = URI.parse('https://example.com/a.cpp');

    await expect(service.readFile(remote)).rejects.toThrow(/不支持的/);
    await expect(service.writeFile(remote, 'x')).rejects.toThrow(/不支持的/);
    await expect(service.exists(remote)).rejects.toThrow(/不支持的/);
    await expect(service.readDirectory(remote)).rejects.toThrow(/不支持的/);
  });
});
