import type { URI } from '@oi/base';
import type { DiagnosticSeverity, ICodeDiagnostic } from '@oi/platform';

const LOCATION_PATTERN = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/;
const UNLOCATED_ERROR_PATTERN = /error:\s*(.+)$/;

export interface IMapSourceFileResult {
  readonly fileName: string;
  readonly uri?: URI;
}

/**
 * 把编译器输出中的文件路径映射为展示名与 URI（临时源文件映射回用户文件）。
 */
export type MapSourceFile = (fileName: string) => IMapSourceFileResult;

export interface IParseDiagnosticsOptions {
  readonly mapSourceFile?: MapSourceFile;
  readonly maxDiagnostics?: number;
}

function severityOf(token: string): DiagnosticSeverity {
  if (token === 'warning') {
    return 'warning';
  }
  if (token === 'note') {
    return 'info';
  }
  return 'error';
}

/**
 * 解析 g++ 诊断输出为结构化列表：
 * 匹配 `文件:行:列: 级别: 原因`；链接等无位置错误行按整行收入（line/column 为 0）。
 */
export function parseCppDiagnostics(
  output: string,
  options: IParseDiagnosticsOptions = {},
): ICodeDiagnostic[] {
  const maxDiagnostics = options.maxDiagnostics ?? 100;
  const diagnostics: ICodeDiagnostic[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    if (diagnostics.length >= maxDiagnostics) {
      break;
    }
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      continue;
    }
    const match = LOCATION_PATTERN.exec(line);
    if (match) {
      const [, file = '', lineText = '0', columnText = '0', severityToken = 'error', message = ''] =
        match;
      const mapped = options.mapSourceFile?.(file) ?? { fileName: file };
      diagnostics.push({
        severity: severityOf(severityToken),
        message,
        line: Number.parseInt(lineText, 10),
        column: Number.parseInt(columnText, 10),
        ...mapped,
      });
      continue;
    }
    // 链接错误（如 collect2 / ld）没有 文件:行:列 前缀，保留整行提示
    if (!line.startsWith(' ') && UNLOCATED_ERROR_PATTERN.test(line)) {
      diagnostics.push({ severity: 'error', message: line, line: 0, column: 0 });
    }
  }
  return diagnostics;
}
