import { describe, expect, it } from 'vitest';
import { carriesFiles, droppedPaths } from './droppedFiles';

function transfer(types: readonly string[]): DataTransfer {
  return { types } as unknown as DataTransfer;
}

/** 单测只关心名字到路径的映射，不需要真的 File 实例。 */
function dropped(name: string): File {
  return { name } as unknown as File;
}

describe('droppedPaths', () => {
  it('按拖放顺序取路径，跳过空路径与重复项', () => {
    const files = [dropped('a.cpp'), dropped('b.cpp'), dropped('a.cpp'), dropped('x')];
    const paths = droppedPaths(files, (file) => (file.name === 'x' ? '' : `C:/oi/${file.name}`));

    expect(paths).toEqual(['C:/oi/a.cpp', 'C:/oi/b.cpp']);
  });

  it('解析结果带空白时归一后再比较', () => {
    expect(droppedPaths([dropped('a.cpp')], () => '  C:/oi/a.cpp  ')).toEqual(['C:/oi/a.cpp']);
  });
});

describe('carriesFiles', () => {
  it('只有含 Files 的拖拽才算文件拖放', () => {
    expect(carriesFiles(transfer(['Files']))).toBe(true);
    expect(carriesFiles(transfer(['text/plain']))).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});
