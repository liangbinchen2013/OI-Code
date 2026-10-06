import {
  DisposableStore,
  Emitter,
  type Event,
  type IDisposable,
  onUnexpectedError,
  toDisposable,
} from '@oi/base';
import {
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  RpcError,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from './protocol';

/**
 * 消息传输抽象：渲染进程经 preload、主进程经 ipcMain 各自实现。
 */
export interface IMessageTransport {
  readonly onMessage: Event<unknown>;
  send(message: unknown): void;
}

export type RpcMethodHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * JSON-RPC 双向通道：两端均可发起调用、注册方法与订阅通知。
 */
export interface IChannel extends IDisposable {
  call<T>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  registerMethod(method: string, handler: RpcMethodHandler): IDisposable;
  listen(method: string, handler: (params: unknown) => void): IDisposable;
}

interface PendingCall {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

/**
 * JSON-RPC 2.0 通道实现。释放时拒绝全部未完成调用。
 */
export class RpcChannel implements IChannel {
  private readonly _disposables = new DisposableStore();
  private readonly _pending = new Map<JsonRpcId, PendingCall>();
  private readonly _methodHandlers = new Map<string, RpcMethodHandler>();
  private readonly _notificationListeners = new Emitter<{ method: string; params: unknown }>();
  private _nextId = 1;
  private _isDisposed = false;

  constructor(private readonly _transport: IMessageTransport) {
    this._disposables.add(_transport.onMessage((message) => this._handleMessage(message)));
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    if (this._isDisposed) {
      return Promise.reject(new Error('RPC 通道已释放'));
    }
    const id = this._nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise<T>((resolve, reject) => {
      this._pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });
      this._transport.send(request);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this._isDisposed) {
      return;
    }
    this._transport.send({
      jsonrpc: JSON_RPC_VERSION,
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  registerMethod(method: string, handler: RpcMethodHandler): IDisposable {
    if (this._methodHandlers.has(method)) {
      throw new Error(`方法已注册：${method}`);
    }
    this._methodHandlers.set(method, handler);
    return toDisposable(() => {
      this._methodHandlers.delete(method);
    });
  }

  listen(method: string, handler: (params: unknown) => void): IDisposable {
    return this._notificationListeners.event((notification) => {
      if (notification.method === method) {
        handler(notification.params);
      }
    });
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._disposables.dispose();
    this._notificationListeners.dispose();
    for (const pending of this._pending.values()) {
      pending.reject(new Error('RPC 通道已释放'));
    }
    this._pending.clear();
  }

  private _handleMessage(message: unknown): void {
    if (isJsonRpcResponse(message)) {
      this._handleResponse(message);
      return;
    }
    if (isJsonRpcRequest(message)) {
      void this._handleRequest(message);
      return;
    }
    if (isJsonRpcNotification(message)) {
      this._notificationListeners.fire({ method: message.method, params: message.params });
      return;
    }
    onUnexpectedError(new Error('收到无法识别的 IPC 消息'));
  }

  private _handleResponse(response: JsonRpcResponse): void {
    if ('error' in response) {
      const error = new RpcError(response.error.code, response.error.message, response.error.data);
      if (response.id === null) {
        onUnexpectedError(error);
        return;
      }
      const pending = this._pending.get(response.id);
      this._pending.delete(response.id);
      if (pending) {
        pending.reject(error);
      } else {
        onUnexpectedError(error);
      }
      return;
    }
    const pending = this._pending.get(response.id);
    if (!pending) {
      onUnexpectedError(new Error(`收到未知调用的响应：${response.id}`));
      return;
    }
    this._pending.delete(response.id);
    pending.resolve(response.result);
  }

  private async _handleRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this._methodHandlers.get(request.method);
    if (!handler) {
      this._sendError(
        request.id,
        JSON_RPC_ERROR_CODES.methodNotFound,
        `未注册的方法：${request.method}`,
      );
      return;
    }
    try {
      const result = await handler(request.params);
      this._transport.send({ jsonrpc: JSON_RPC_VERSION, id: request.id, result });
    } catch (error) {
      // 处理器显式抛出的 RpcError 携带业务错误码（如访问被拒），原样透传给调用方
      if (error instanceof RpcError) {
        this._sendError(request.id, error.code, error.message, error.data);
        return;
      }
      this._sendError(
        request.id,
        JSON_RPC_ERROR_CODES.internalError,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private _sendError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    this._transport.send({
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    });
  }
}
