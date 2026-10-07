/**
 * 无扩展名文件的轻量语言识别：按内容特征猜测 C++ / Python。
 * 仅用于补齐编译运行与高亮，不做严格解析。
 */
export type DetectedLanguage = 'cpp' | 'python';

const CPP_MARKERS: readonly RegExp[] = [
  /#\s*include\b/,
  /using\s+namespace\s+std\b/,
  /\bstd::/,
  /\bint\s+main\s*\(/,
  /\bcout\s*<</,
  /\bcin\s*>>/,
  /\bprintf\s*\(/,
];

const PYTHON_MARKERS: readonly RegExp[] = [
  /^\s*def\s+\w+\s*\(/m,
  /^\s*import\s+\w+/m,
  /^\s*from\s+\w+\s+import\b/m,
  /^\s*class\s+\w+.*:\s*$/m,
  /\bprint\s*\(/,
  /if\s+__name__\s*==/,
];

export function detectLanguageFromContent(content: string): DetectedLanguage | undefined {
  if (CPP_MARKERS.some((pattern) => pattern.test(content))) {
    return 'cpp';
  }
  if (PYTHON_MARKERS.some((pattern) => pattern.test(content))) {
    return 'python';
  }
  return undefined;
}
