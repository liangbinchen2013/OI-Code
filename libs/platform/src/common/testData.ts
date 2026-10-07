/**
 * 测试数据配对：按“同前缀 + 输入/输出后缀”识别成对文件。
 * 支持 .in/.out、.in/.ans、.input/.output 三类命名习惯。
 */
export interface ITestDataEntry {
  /** 相对路径或文件名（可含目录），用于前缀匹配与展示。 */
  readonly path: string;
  readonly content: string;
}

export interface IPairedTestCase {
  readonly name: string;
  readonly input: string;
  readonly expectedOutput: string;
}

export const TEST_DATA_INPUT_SUFFIXES: readonly string[] = ['in', 'input'];
export const TEST_DATA_OUTPUT_SUFFIXES: readonly string[] = ['out', 'ans', 'output'];

interface ICaseParts {
  readonly displayName: string;
  input?: string;
  expectedOutput?: string;
}

function suffixOf(fileName: string): string | undefined {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : undefined;
}

function baseOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('.');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

/**
 * 配对文件列表；无成对文件的条目被忽略，结果按名称排序。
 */
export function pairTestData(entries: readonly ITestDataEntry[]): IPairedTestCase[] {
  const groups = new Map<string, ICaseParts>();
  for (const entry of entries) {
    const fileName = entry.path.replace(/\\/g, '/').split('/').pop() ?? entry.path;
    const suffix = suffixOf(fileName);
    if (suffix === undefined) {
      continue;
    }
    const isInput = TEST_DATA_INPUT_SUFFIXES.includes(suffix);
    const isOutput = TEST_DATA_OUTPUT_SUFFIXES.includes(suffix);
    if (!isInput && !isOutput) {
      continue;
    }
    const key = baseOf(entry.path).toLowerCase();
    const current = groups.get(key) ?? {
      displayName: fileName.slice(0, fileName.lastIndexOf('.')),
    };
    groups.set(key, {
      displayName: current.displayName,
      ...(isInput ? { input: entry.content } : { input: current.input }),
      ...(isOutput
        ? { expectedOutput: entry.content }
        : { expectedOutput: current.expectedOutput }),
    });
  }
  const cases: IPairedTestCase[] = [];
  for (const parts of groups.values()) {
    if (parts.input !== undefined && parts.expectedOutput !== undefined) {
      cases.push({
        name: parts.displayName,
        input: parts.input,
        expectedOutput: parts.expectedOutput,
      });
    }
  }
  return cases.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true }),
  );
}
