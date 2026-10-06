import { describe, expect, it, vi } from 'vitest';
import {
  DisposableStore,
  combinedDisposable,
  dispose,
  isDisposable,
  toDisposable,
} from './lifecycle';

describe('DisposableStore', () => {
  it('释放时按加入顺序释放全部资源且只释放一次', () => {
    const order: number[] = [];
    const store = new DisposableStore();
    store.add(toDisposable(() => order.push(1)));
    store.add(toDisposable(() => order.push(2)));

    expect(store.isDisposed).toBe(false);
    store.dispose();
    store.dispose();

    expect(order).toEqual([1, 2]);
    expect(store.isDisposed).toBe(true);
  });

  it('已释放后再添加会立即释放新资源', () => {
    const store = new DisposableStore();
    store.dispose();
    const disposeFn = vi.fn();

    store.add(toDisposable(disposeFn));

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('clear 之后 store 仍可继续使用', () => {
    const first = vi.fn();
    const second = vi.fn();
    const store = new DisposableStore();
    store.add(toDisposable(first));
    store.clear();
    store.add(toDisposable(second));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(store.isDisposed).toBe(false);

    store.dispose();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('重复添加同一实例只释放一次', () => {
    const disposeFn = vi.fn();
    const disposable = toDisposable(disposeFn);
    const store = new DisposableStore();
    store.add(disposable);
    store.add(disposable);

    store.dispose();

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('禁止把 store 添加到自身', () => {
    const store = new DisposableStore();
    expect(() => store.add(store)).toThrow();
  });
});

describe('生命周期工具函数', () => {
  it('isDisposable 识别真实契约', () => {
    expect(isDisposable(toDisposable(() => {}))).toBe(true);
    expect(isDisposable({ dispose: 'not-a-function' })).toBe(false);
    expect(isDisposable(null)).toBe(false);
    expect(isDisposable('dispose')).toBe(false);
  });

  it('dispose 释放并返回原资源', () => {
    const disposeFn = vi.fn();
    const disposable = toDisposable(disposeFn);

    expect(dispose(disposable)).toBe(disposable);
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('combinedDisposable 依次释放全部资源', () => {
    const order: string[] = [];
    const combined = combinedDisposable([
      toDisposable(() => order.push('a')),
      toDisposable(() => order.push('b')),
    ]);

    combined.dispose();

    expect(order).toEqual(['a', 'b']);
  });
});
