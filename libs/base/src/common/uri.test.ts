import { describe, expect, it } from 'vitest';
import { URI } from './uri';

describe('URI', () => {
  it('解析完整 URI 的各个组成部分', () => {
    const uri = URI.parse('https://example.com/a/b?x=1#frag');

    expect(uri.scheme).toBe('https');
    expect(uri.authority).toBe('example.com');
    expect(uri.path).toBe('/a/b');
    expect(uri.query).toBe('x=1');
    expect(uri.fragment).toBe('frag');
    expect(uri.toString()).toBe('https://example.com/a/b?x=1#frag');
  });

  it('解析无 authority 的 URI', () => {
    const uri = URI.parse('untitled:Untitled-1');

    expect(uri.scheme).toBe('untitled');
    expect(uri.authority).toBe('');
    expect(uri.path).toBe('Untitled-1');
    expect(uri.toString()).toBe('untitled:Untitled-1');
  });

  it('无法解析时抛出错误', () => {
    expect(() => URI.parse('')).toThrow();
  });

  it('file 路径规范化并可还原 fsPath', () => {
    const uri = URI.file('C:\\Users\\oi\\main.cpp');

    expect(uri.scheme).toBe('file');
    expect(uri.path).toBe('/C:/Users/oi/main.cpp');
    expect(uri.fsPath).toBe('C:/Users/oi/main.cpp');
    expect(uri.toString()).toBe('file:///C:/Users/oi/main.cpp');
  });

  it('file 相对路径自动补前导斜杠', () => {
    expect(URI.file('tmp/a.txt').path).toBe('/tmp/a.txt');
  });

  it('with 生成变更后的新实例且保持不可变', () => {
    const original = URI.parse('https://example.com/a?x=1');
    const changed = original.with({ path: '/b' });

    expect(changed.path).toBe('/b');
    expect(changed.query).toBe('x=1');
    expect(changed.toString()).toBe('https://example.com/b?x=1');
    expect(original.path).toBe('/a');
  });

  it('isUri 只识别 URI 实例', () => {
    expect(URI.isUri(URI.file('/a'))).toBe(true);
    expect(URI.isUri('file:///a')).toBe(false);
  });
});
