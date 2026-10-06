type UnexpectedErrorHandler = (error: unknown) => void;

let unexpectedErrorHandler: UnexpectedErrorHandler | undefined;

/**
 * 注册全局未预期错误处理器。应用启动时必须调用，把错误交给 ILogService 落盘。
 * 未注册时 {@link onUnexpectedError} 直接抛出，确保错误不会被静默吞掉。
 */
export function setUnexpectedErrorHandler(handler: UnexpectedErrorHandler | undefined): void {
  unexpectedErrorHandler = handler;
}

/**
 * 上报未预期错误：已注册处理器时转交处理器，否则直接抛出。
 */
export function onUnexpectedError(error: unknown): void {
  if (unexpectedErrorHandler) {
    unexpectedErrorHandler(error);
    return;
  }
  throw toError(error);
}

/**
 * 把任意异常值统一归一化为 Error。
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  return new Error(`未预期的错误值：${safeStringify(error)}`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
