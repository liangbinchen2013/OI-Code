import { describe, expect, it } from 'vitest';
import { normalizeOutput } from './judgeService';

describe('normalizeOutput', () => {
  it('统一换行并忽略行尾空白', () => {
    expect(normalizeOutput('1 2\r\n3  \r\n')).toBe('1 2\n3');
    expect(normalizeOutput('a\t\nb')).toBe('a\nb');
  });

  it('忽略文件末尾多余空行，但保留内部空行', () => {
    expect(normalizeOutput('a\n\nb\n\n\n')).toBe('a\n\nb');
  });
});
