import { describe, expect, it } from 'vitest';
import { detectLanguageFromContent } from './languageDetection';

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

  it('无法识别时返回 undefined', () => {
    expect(detectLanguageFromContent('')).toBeUndefined();
    expect(detectLanguageFromContent('hello world')).toBeUndefined();
  });

  it('同时出现两类特征时优先 C++', () => {
    expect(detectLanguageFromContent('#include <iostream>\nprint(1)')).toBe('cpp');
  });
});
