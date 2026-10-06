import { URI } from '@oi/base';

/**
 * 诊断严重级别，与 UI 展示和 Monaco marker 一一对应。
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * 单条代码诊断；line/column 从 1 起，0 表示无位置信息（如链接错误）。
 */
export interface ICodeDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  /** 面向用户的文件名（无路径）。 */
  readonly fileName?: string;
  /** 诊断所属文档；头文件等未打开文档也可携带。 */
  readonly uri?: URI;
}

/**
 * 诊断的 IPC 线格式：URI 退化为字符串。
 */
export interface ICodeDiagnosticWire {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly fileName?: string;
  readonly uri?: string;
}

export function serializeDiagnostic(diagnostic: ICodeDiagnostic): ICodeDiagnosticWire {
  const { uri, ...rest } = diagnostic;
  return { ...rest, ...(uri === undefined ? {} : { uri: uri.toString() }) };
}

export function deserializeDiagnostic(wire: ICodeDiagnosticWire): ICodeDiagnostic {
  const { uri, ...rest } = wire;
  return { ...rest, ...(uri === undefined ? {} : { uri: URI.parse(uri) }) };
}
