import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URI } from '@oi/base';
import { LogService } from '@oi/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutoSaveService, draftFileName, parseDraftFile } from './autoSaveService';

describe('draftFileName', () => {
  it('由原始文件名与 URI 哈希构成且稳定', () => {
    const uri = URI.file('C:/problems/T1.cpp').toString();
    const first = draftFileName(uri);
    expect(first).toBe(draftFileName(uri));
    expect(first).toContain('T1.cpp.');
    expect(first.endsWith('.oi-autosave')).toBe(true);
  });

  it('剔除文件名中的非法字符，untitled 回退占位名', () => {
    const weird = draftFileName('untitled:///a<b>c?d.cpp');
    expect(weird).not.toMatch(/[<>?]/);
    expect(draftFileName('untitled:')).toContain('untitled.');
  });
});

describe('parseDraftFile', () => {
  it('合法 JSON 通过，字段缺失或损坏返回 undefined', () => {
    expect(parseDraftFile('{"uri":"u","content":"c","savedAtMs":1}')).toEqual({
      uri: 'u',
      content: 'c',
      savedAtMs: 1,
    });
    expect(parseDraftFile('{"uri":"u"}')).toBeUndefined();
    expect(parseDraftFile('not json')).toBeUndefined();
  });
});

describe('AutoSaveService', () => {
  let directory: string;
  let logService: LogService;
  let service: AutoSaveService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oi-autosave-test-'));
    logService = new LogService();
    service = new AutoSaveService(logService, directory);
  });

  afterEach(async () => {
    logService.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('写入后扫描可恢复，clearDraft 删除草稿', async () => {
    const sourcePath = join(directory, 'main.cpp');
    await writeFile(sourcePath, 'int main() {}', 'utf8');
    const uri = URI.file(sourcePath).toString();

    await service.saveDraft(uri, 'int main() { /* dirty */ }');
    const drafts = await service.scanDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.uri).toBe(uri);
    expect(drafts[0]?.content).toContain('dirty');

    await service.clearDraft(uri);
    expect(await service.scanDrafts()).toEqual([]);
  });

  it('原文件在草稿后被修改则草稿过期并被清理', async () => {
    const sourcePath = join(directory, 'edited.cpp');
    await writeFile(sourcePath, 'v1', 'utf8');
    const uri = URI.file(sourcePath).toString();
    await service.saveDraft(uri, 'draft');

    const future = new Date(Date.now() + 5_000);
    await utimes(sourcePath, future, future);

    expect(await service.scanDrafts()).toEqual([]);
    const remaining = (await readdir(directory)).filter((entry) => entry.endsWith('.oi-autosave'));
    expect(remaining).toEqual([]);
  });

  it('untitled 草稿无原文可比对，视为可恢复', async () => {
    const uri = URI.from({ scheme: 'untitled', path: '/未命名-1.cpp' }).toString();
    await service.saveDraft(uri, 'print(1)');
    const drafts = await service.scanDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.uri).toBe(uri);
  });

  it('损坏草稿在扫描时清理，clearAllDrafts 清空目录', async () => {
    const broken = join(directory, `broken.1234.oi-autosave`);
    await writeFile(broken, 'not json', 'utf8');
    expect(await service.scanDrafts()).toEqual([]);
    await expect(readFile(broken, 'utf8')).rejects.toThrow();

    await service.saveDraft('untitled:///x.cpp', 'x');
    await service.clearAllDrafts();
    expect(await service.scanDrafts()).toEqual([]);
  });
});
