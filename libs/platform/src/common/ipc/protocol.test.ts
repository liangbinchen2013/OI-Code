import { describe, expect, it } from 'vitest';
import {
  APP_RPC_ERROR_CODES,
  DIALOG_RPC_METHODS,
  FILE_RPC_METHODS,
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  RpcError,
  WINDOW_RPC_NOTIFICATIONS,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from './protocol';

describe('JSON-RPC 协议校验', () => {
  it('识别请求并拒绝响应与通知', () => {
    const request = { jsonrpc: JSON_RPC_VERSION, id: 1, method: 'ping' };

    expect(isJsonRpcRequest(request)).toBe(true);
    expect(isJsonRpcRequest({ ...request, result: null })).toBe(false);
    expect(isJsonRpcRequest({ jsonrpc: JSON_RPC_VERSION, method: 'ping' })).toBe(false);
    expect(isJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBe(false);
  });

  it('识别通知并拒绝请求', () => {
    expect(isJsonRpcNotification({ jsonrpc: JSON_RPC_VERSION, method: 'log' })).toBe(true);
    expect(isJsonRpcNotification({ jsonrpc: JSON_RPC_VERSION, method: 'log', id: 1 })).toBe(false);
  });

  it('识别成功与错误响应', () => {
    expect(isJsonRpcResponse({ jsonrpc: JSON_RPC_VERSION, id: 1, result: 'pong' })).toBe(true);
    expect(
      isJsonRpcResponse({
        jsonrpc: JSON_RPC_VERSION,
        id: null,
        error: { code: JSON_RPC_ERROR_CODES.parseError, message: 'bad' },
      }),
    ).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'ping' })).toBe(false);
  });

  it('RpcError 保留错误码与数据', () => {
    const error = new RpcError(JSON_RPC_ERROR_CODES.internalError, 'failed', { detail: 1 });

    expect(error.name).toBe('RpcError');
    expect(error.code).toBe(-32603);
    expect(error.data).toEqual({ detail: 1 });
  });

  it('RPC 方法名全局唯一且应用错误码在保留区间内', () => {
    const methodNames = [
      ...Object.values(FILE_RPC_METHODS),
      ...Object.values(DIALOG_RPC_METHODS),
      ...Object.values(WINDOW_RPC_NOTIFICATIONS),
    ];

    expect(new Set(methodNames).size).toBe(methodNames.length);
    expect(APP_RPC_ERROR_CODES.accessDenied).toBeGreaterThanOrEqual(-32099);
    expect(APP_RPC_ERROR_CODES.accessDenied).toBeLessThanOrEqual(-32000);
  });
});
