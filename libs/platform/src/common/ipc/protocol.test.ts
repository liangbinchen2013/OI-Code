import { describe, expect, it } from 'vitest';
import {
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  RpcError,
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
});
