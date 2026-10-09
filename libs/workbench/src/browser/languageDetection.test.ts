import { describe, expect, it } from 'vitest';
import {
  detectLanguageFromContent,
  guessLanguage,
  LANGUAGE_CONFIDENCE_THRESHOLD,
  LANGUAGE_EXTENSIONS,
  suggestFileName,
} from './languageDetection';

describe('detectLanguageFromContent', () => {
  it('识别 C++ 特征', () => {
    expect(detectLanguageFromContent('#include <iostream>\nint main() {}')).toBe('cpp');
    expect(detectLanguageFromContent('using namespace std;\nint x;')).toBe('cpp');
    expect(detectLanguageFromContent('#include <cstdio>\nint main(){ printf("hi"); }')).toBe('cpp');
  });

  it('识别 Python 特征', () => {
    expect(detectLanguageFromContent('def solve(n):\n    return n')).toBe('python');
    expect(detectLanguageFromContent('import sys\nprint(sys.argv)')).toBe('python');
    expect(detectLanguageFromContent('if __name__ == "__main__":\n    main()')).toBe('python');
  });

  it('识别 JavaScript 与 HTML', () => {
    expect(detectLanguageFromContent('const n = 5;\nconsole.log(n * 2);')).toBe('javascript');
    expect(detectLanguageFromContent('function main() {\n  document.getElementById("a");\n}')).toBe(
      'javascript',
    );
    expect(
      detectLanguageFromContent('<!DOCTYPE html>\n<html><body><div>x</div></body></html>'),
    ).toBe('html');
  });

  it('证据不足时不下结论，等用户继续输入', () => {
    expect(detectLanguageFromContent('')).toBeUndefined();
    expect(detectLanguageFromContent('hello world')).toBeUndefined();
    // 单个 import 既像 Python 又像 JS，弱信号不足以定型
    expect(detectLanguageFromContent('import os')).toBeUndefined();
    expect(detectLanguageFromContent('console.log(1)')).toBeUndefined();
    expect(detectLanguageFromContent('<div>正文</div>')).toBeUndefined();
    // 继续写下去就够了
    expect(
      detectLanguageFromContent('import os\nprint(os.getcwd())\nfor i in range(3):\n    pass'),
    ).toBe('python');
  });

  it('强标记一票定型，即使混入其他语言特征', () => {
    expect(detectLanguageFromContent('#include <iostream>\nprint(1)')).toBe('cpp');
    expect(detectLanguageFromContent('def main():\n    cout << 1')).toBe('python');
  });

  it('置信度随证据增长而提高', () => {
    const weak = guessLanguage('import os');
    const strong = guessLanguage('import os\nprint(os.getcwd())\nn = int(input())');
    expect(weak).toBeDefined();
    expect(weak?.confidence).toBeLessThan(LANGUAGE_CONFIDENCE_THRESHOLD);
    expect(strong?.language).toBe('python');
    expect(strong?.confidence).toBeGreaterThanOrEqual(LANGUAGE_CONFIDENCE_THRESHOLD);
  });

  it('保存建议的后缀与语言一致', () => {
    expect(LANGUAGE_EXTENSIONS.cpp).toBe('cpp');
    expect(LANGUAGE_EXTENSIONS.python).toBe('py');
    expect(LANGUAGE_EXTENSIONS.javascript).toBe('js');
    expect(LANGUAGE_EXTENSIONS.html).toBe('html');
  });

  it('建议文件名只在无后缀且已定型时补后缀', () => {
    expect(suggestFileName('未命名-1', 'cpp')).toBe('未命名-1.cpp');
    expect(suggestFileName('未命名-2', 'python')).toBe('未命名-2.py');
    expect(suggestFileName('未命名-3', 'javascript')).toBe('未命名-3.js');
    expect(suggestFileName('未命名-4', undefined)).toBe('未命名-4');
    // 已有后缀就不动
    expect(suggestFileName('main.cpp', 'python')).toBe('main.cpp');
    expect(suggestFileName('v1.2', 'python')).toBe('v1.2');
  });
});
