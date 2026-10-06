/**
 * 可释放资源契约：所有持有订阅、定时器、句柄的对象必须实现。
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * 判断任意值是否实现 {@link IDisposable}。
 */
export function isDisposable(thing: unknown): thing is IDisposable {
  return (
    typeof thing === 'object' &&
    thing !== null &&
    typeof (thing as { dispose?: unknown }).dispose === 'function'
  );
}

/**
 * 将释放回调包装为 {@link IDisposable}。
 */
export function toDisposable(disposeFn: () => void): IDisposable {
  return { dispose: disposeFn };
}

/**
 * 释放单个资源并原样返回，便于链式书写。
 */
export function dispose<T extends IDisposable>(disposable: T): T {
  disposable.dispose();
  return disposable;
}

/**
 * 把多个资源合并为单个 {@link IDisposable}。
 */
export function combinedDisposable(disposables: readonly IDisposable[]): IDisposable {
  return toDisposable(() => {
    for (const disposable of disposables) {
      disposable.dispose();
    }
  });
}

/**
 * 资源集合：统一管理订阅、监听、定时器与句柄的生命周期。
 * 重复添加同一实例只保留一份；已释放后再添加会立即释放新资源。
 */
export class DisposableStore implements IDisposable {
  private readonly _toDispose = new Set<IDisposable>();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  add<T extends IDisposable>(disposable: T): T {
    if (disposable === (this as unknown as IDisposable)) {
      throw new Error('无法把 DisposableStore 添加到自身');
    }
    if (this._isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this._toDispose.add(disposable);
    return disposable;
  }

  clear(): void {
    if (this._toDispose.size === 0) {
      return;
    }
    const toDispose = [...this._toDispose];
    this._toDispose.clear();
    for (const disposable of toDispose) {
      disposable.dispose();
    }
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.clear();
  }
}

/**
 * 便于继承的资源持有基类：子类把资源注册进 `_store` 即可获得统一释放能力。
 */
export class Disposable implements IDisposable {
  protected readonly _store = new DisposableStore();

  dispose(): void {
    this._store.dispose();
  }

  protected _register<T extends IDisposable>(disposable: T): T {
    return this._store.add(disposable);
  }
}
