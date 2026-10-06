export const JSON_RPC_VERSION = '2.0';

/**
 * JSON-RPC 2.0 标准错误码。
 */
export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId | null;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/**
 * 远端返回的 JSON-RPC 错误。
 */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    value.jsonrpc === JSON_RPC_VERSION &&
    (typeof value.id === 'number' || typeof value.id === 'string') &&
    typeof value.method === 'string' &&
    !('result' in value) &&
    !('error' in value)
  );
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return (
    isRecord(value) &&
    value.jsonrpc === JSON_RPC_VERSION &&
    typeof value.method === 'string' &&
    !('id' in value)
  );
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    isRecord(value) &&
    value.jsonrpc === JSON_RPC_VERSION &&
    'id' in value &&
    ('result' in value || 'error' in value)
  );
}
