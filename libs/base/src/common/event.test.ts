import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUnexpectedErrorHandler } from './errors';
import { Emitter } from './event';

afterEach(() => {
  setUnexpectedErrorHandler(undefined);
});

describe('Emitter', () => {
  it('订阅后收到事件，取消订阅后不再收到', () => {
    const emitter = new Emitter<number>();
    const received: number[] = [];
    const subscription = emitter.event((value) => received.push(value));

    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);

    expect(received).toEqual([1]);
  });

  it('thisArg 在监听器内生效', () => {
    const emitter = new Emitter<string>();
    const context = { name: 'context', received: '' };
    emitter.event(function (this: typeof context, value: string) {
      this.received = `${this.name}:${value}`;
    }, context);

    emitter.fire('ping');

    expect(context.received).toBe('context:ping');
  });

  it('传入 disposables 数组时订阅被自动收集', () => {
    const emitter = new Emitter<void>();
    const disposables: { dispose(): void }[] = [];
    emitter.event(() => {}, undefined, disposables);

    expect(disposables).toHaveLength(1);
    disposables[0]?.dispose();
    expect(emitter.hasListeners()).toBe(false);
  });

  it('释放后再触发会抛出', () => {
    const emitter = new Emitter<void>();
    emitter.dispose();

    expect(() => emitter.fire()).toThrow();
  });

  it('监听器异常交给 onUnexpectedError 且不中断其他监听器', () => {
    const errors: unknown[] = [];
    setUnexpectedErrorHandler((error) => errors.push(error));
    const emitter = new Emitter<void>();
    const calls = vi.fn();
    emitter.event(() => {
      throw new Error('listener failed');
    });
    emitter.event(calls);

    emitter.fire();

    expect(errors).toHaveLength(1);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
