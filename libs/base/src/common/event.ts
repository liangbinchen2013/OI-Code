import { onUnexpectedError } from './errors';
import { type IDisposable, toDisposable } from './lifecycle';

/**
 * 事件订阅契约：注册监听器并返回用于取消订阅的 {@link IDisposable}。
 */
export interface Event<T> {
  (listener: (event: T) => unknown, thisArg?: unknown, disposables?: IDisposable[]): IDisposable;
}

interface Listener<T> {
  readonly callback: (event: T) => unknown;
  readonly thisArg: unknown;
}

/**
 * 事件发射器：事件源持有 Emitter，订阅方只拿到 {@link Emitter.event}。
 * 监听器抛出的异常统一交给 onUnexpectedError，不中断其余监听器；释放后再触发会抛错。
 */
export class Emitter<T> implements IDisposable {
  private readonly _listeners = new Set<Listener<T>>();
  private _event: Event<T> | undefined;
  private _isDisposed = false;

  get event(): Event<T> {
    this._event ??= (listener, thisArg, disposables) => {
      if (this._isDisposed) {
        return toDisposable(() => {});
      }
      const entry: Listener<T> = { callback: listener, thisArg };
      this._listeners.add(entry);
      const subscription = toDisposable(() => {
        this._listeners.delete(entry);
      });
      disposables?.push(subscription);
      return subscription;
    };
    return this._event;
  }

  hasListeners(): boolean {
    return this._listeners.size > 0;
  }

  fire(event: T): void {
    if (this._isDisposed) {
      throw new Error('Emitter 已释放，无法再触发事件');
    }
    for (const listener of [...this._listeners]) {
      if (!this._listeners.has(listener)) {
        continue;
      }
      try {
        listener.callback.call(listener.thisArg, event);
      } catch (error) {
        onUnexpectedError(error);
      }
    }
  }

  dispose(): void {
    this._isDisposed = true;
    this._event = undefined;
    this._listeners.clear();
  }
}
