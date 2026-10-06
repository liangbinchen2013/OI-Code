import { URI } from '@oi/base';
import { describe, expect, it } from 'vitest';
import { parseCppDiagnostics } from './cppDiagnostics';

const SAMPLE_OUTPUT = [
  "C:\\problems\\T1.oi-code-tmp.cpp: In function 'int main()':",
  "C:\\problems\\T1.oi-code-tmp.cpp:4:13: error: 'cout' was not declared in this scope",
  '    4 |     cout << 1;',
  '      |     ^~~~',
  "C:\\problems\\T1.oi-code-tmp.cpp:5:9: warning: unused variable 'x' [-Wunused-variable]",
  '    5 |     int x = 0;',
  '      |         ^',
  'C:\\problems\\T1.oi-code-tmp.cpp:6:1: note: suggested alternative:',
  'collect2.exe: error: ld returned 1 exit status',
].join('\r\n');

describe('parseCppDiagnostics', () => {
  it('解析文件、行、列、级别与原因', () => {
    const diagnostics = parseCppDiagnostics(SAMPLE_OUTPUT);

    expect(diagnostics).toHaveLength(4);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      line: 4,
      column: 13,
      message: "'cout' was not declared in this scope",
    });
    expect(diagnostics[1]).toMatchObject({ severity: 'warning', line: 5, column: 9 });
    expect(diagnostics[2]).toMatchObject({ severity: 'info', line: 6, column: 1 });
    expect(diagnostics[3]).toMatchObject({ severity: 'error', line: 0, column: 0 });
    expect(diagnostics[3]?.message).toContain('collect2.exe');
  });

  it('mapSourceFile 把临时源文件映射回用户文件', () => {
    const userUri = URI.file('C:/problems/T1.cpp');
    const diagnostics = parseCppDiagnostics(SAMPLE_OUTPUT, {
      mapSourceFile: (fileName) => {
        if (fileName.endsWith('T1.oi-code-tmp.cpp')) {
          return { fileName: 'T1.cpp', uri: userUri };
        }
        return { fileName };
      },
    });

    expect(diagnostics[0]?.fileName).toBe('T1.cpp');
    expect(diagnostics[0]?.uri?.fsPath).toBe('C:/problems/T1.cpp');
  });

  it('fatal error 归为错误，结果数量受上限约束', () => {
    const output = Array.from(
      { length: 10 },
      (_, index) => `a.cpp:${index + 1}:1: fatal error: missing.h: No such file`,
    ).join('\n');
    const diagnostics = parseCppDiagnostics(output, { maxDiagnostics: 3 });

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('忽略无 error: 的提示行（如 In file included from）', () => {
    const output = [
      'In file included from C:\\a.cpp:1:',
      'C:\\bits\\stdc++.h:1:1: error: sample',
      ' 1 | #include <x>',
    ].join('\n');

    const diagnostics = parseCppDiagnostics(output);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(1);
  });
});
