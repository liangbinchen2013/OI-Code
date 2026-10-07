import { describe, expect, it } from 'vitest';
import { pairTestData } from './testData';

describe('pairTestData', () => {
  it('按同前缀配对 .in/.out', () => {
    expect(
      pairTestData([
        { path: 'test1.in', content: '1 2' },
        { path: 'test1.out', content: '3' },
        { path: 'test2.in', content: '4 5' },
        { path: 'test2.out', content: '9' },
        { path: 'readme.md', content: '忽略' },
      ]),
    ).toEqual([
      { name: 'test1', input: '1 2', expectedOutput: '3' },
      { name: 'test2', input: '4 5', expectedOutput: '9' },
    ]);
  });

  it('支持 .in/.ans 与 .input/.output', () => {
    expect(
      pairTestData([
        { path: 'a.in', content: 'x' },
        { path: 'a.ans', content: 'y' },
        { path: 'b.input', content: 'p' },
        { path: 'b.output', content: 'q' },
      ]),
    ).toEqual([
      { name: 'a', input: 'x', expectedOutput: 'y' },
      { name: 'b', input: 'p', expectedOutput: 'q' },
    ]);
  });

  it('缺少一方时不生成测试点，子目录前缀区分', () => {
    const cases = pairTestData([
      { path: 'set1/1.in', content: 'a' },
      { path: 'set1/1.out', content: 'b' },
      { path: 'set2/1.in', content: 'c' },
      { path: 'set2/1.out', content: 'd' },
      { path: 'orphan.in', content: 'e' },
    ]);

    expect(cases).toHaveLength(2);
    expect(cases[0]).toEqual({ name: '1', input: 'a', expectedOutput: 'b' });
    expect(cases[1]).toEqual({ name: '1', input: 'c', expectedOutput: 'd' });
  });
});
