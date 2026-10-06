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

/**
 * OI-Code 应用层 JSON-RPC 错误码（-32000..-32099 为 JSON-RPC 协议保留给应用的范围）。
 */
export const APP_RPC_ERROR_CODES = {
  accessDenied: -32001,
} as const;

/**
 * 文件服务的 RPC 方法名。
 */
export const FILE_RPC_METHODS = {
  readFile: 'fs.readFile',
  writeFile: 'fs.writeFile',
  exists: 'fs.exists',
  readDirectory: 'fs.readDirectory',
} as const;

/**
 * 对话框服务的 RPC 方法名。
 */
export const DIALOG_RPC_METHODS = {
  showOpenFile: 'dialog.showOpenFile',
  showOpenFolder: 'dialog.showOpenFolder',
  showSaveFile: 'dialog.showSaveFile',
  confirmDiscardChanges: 'dialog.confirmDiscardChanges',
} as const;

/**
 * 主进程与渲染进程之间的窗口级通知方法名（通知无响应）。
 */
export const WINDOW_RPC_NOTIFICATIONS = {
  setDirtyState: 'window.setDirtyState',
} as const;

/**
 * C++ 工具链服务的 RPC 方法名。
 */
export const TOOLCHAIN_RPC_METHODS = {
  getStatus: 'toolchain.getStatus',
  search: 'toolchain.search',
  setDefaultStandard: 'toolchain.setDefaultStandard',
  setCustomFlags: 'toolchain.setCustomFlags',
  compile: 'toolchain.compile',
  run: 'toolchain.run',
  check: 'toolchain.check',
} as const;

/**
 * C++ 工具链的服务端通知方法名。
 */
export const TOOLCHAIN_RPC_NOTIFICATIONS = {
  searchProgress: 'toolchain.searchProgress',
} as const;

/**
 * Python 工具链服务的 RPC 方法名。
 */
export const PYTHON_RPC_METHODS = {
  getStatus: 'python.getStatus',
  search: 'python.search',
  setDefaultInterpreter: 'python.setDefaultInterpreter',
  pipInstall: 'python.pipInstall',
  run: 'python.run',
  check: 'python.check',
} as const;

/**
 * Python 工具链的服务端通知方法名。
 */
export const PYTHON_RPC_NOTIFICATIONS = {
  searchProgress: 'python.searchProgress',
  pipOutput: 'python.pipOutput',
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
