import { afterEach, describe, expect, it } from 'vitest';
import { onUnexpectedError, setUnexpectedErrorHandler, toError } from './errors';

afterEach(() => {
  setUnexpectedErrorHandler(undefined);
});

describe('错误处理', () => {
  it('未注册处理器时 onUnexpectedError 直接抛出', () => {
    expect(() => onUnexpectedError('boom')).toThrow('boom');
  });

  it('注册处理器后错误被转交且不再抛出', () => {
    const errors: unknown[] = [];
    setUnexpectedErrorHandler((error) => errors.push(error));

    onUnexpectedError(new Error('boom'));

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });

  it('重置处理器后恢复直接抛出行为', () => {
    setUnexpectedErrorHandler(() => {});
    setUnexpectedErrorHandler(undefined);

    expect(() => onUnexpectedError(new Error('boom'))).toThrow('boom');
  });

  it('toError 归一化各类异常值', () => {
    const original = new Error('original');
    expect(toError(original)).toBe(original);
    expect(toError('text').message).toBe('text');
    expect(toError({ code: 42 }).message).toContain('42');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toError(circular).message).toContain('object');
  });
});
