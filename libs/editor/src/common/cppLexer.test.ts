import { describe, expect, it } from 'vitest';
import { tokenizeCpp, type ICppToken } from './cppLexer';

function texts(source: string): string[] {
  return tokenizeCpp(source).map((token: ICppToken) => token.text);
}

function kinds(source: string): string {
  return tokenizeCpp(source)
    .map((token) => token.kind)
    .join(',');
}

describe('tokenizeCpp', () => {
  it('切分基本语句并标注关键字', () => {
    expect(kinds('int main() { return 0; }')).toBe(
      'keyword,identifier,punct,punct,punct,keyword,number,punct,punct',
    );
    expect(texts('if (x) f();')).toEqual(['if', '(', 'x', ')', 'f', '(', ')', ';']);
  });

  it('数字字面量整体成 token', () => {
    expect(texts("long long x = 1'000'000;")).toContain("1'000'000");
    expect(texts('unsigned m = 0xFFu;')).toContain('0xFFu');
    expect(texts('int b = 0b1010;')).toContain('0b1010');
    expect(texts('double d = 1e-5;')).toContain('1e-5');
    expect(texts('float f = 2.5f;')).toContain('2.5f');
    expect(texts('auto t = 123_km;')).toContain('123_km');
    expect(texts('double g = .5;')).toContain('.5');
  });

  it('字符串、字符与原始字符串不被切开', () => {
    expect(texts('const char *s = "a\\"b";')).toContain('"a\\"b"');
    expect(texts("char c = '\\'';")).toContain("'\\''");
    expect(texts('auto r = R"delim(a)b)delim";')).toContain('R"delim(a)b)delim"');
    expect(texts('auto u = u8R"(π)";')).toContain('u8R"(π)"');
    expect(texts('const char *p = "if (x) y;";')).toContain('"if (x) y;"');
  });

  it('注释与预处理行各自成 token', () => {
    expect(kinds('// 说明\nint x;')).toBe('lineComment,keyword,identifier,punct');
    expect(kinds('/* 多\n行 */ int x;')).toBe('blockComment,keyword,identifier,punct');
    const macro = tokenizeCpp('#define ADD(a, b) \\\n  ((a) + (b))\nint x;');
    expect(macro[0]?.kind).toBe('preprocessor');
    expect(macro[0]?.text).toBe('#define ADD(a, b) \\\n  ((a) + (b))');
  });

  it('多字符运算符不被拆开', () => {
    expect(texts('vector<vector<int>> v;')).toContain('>>');
    expect(texts('a <<= b >> c;')).toEqual(['a', '<<=', 'b', '>>', 'c', ';']);
    expect(texts('p->q != r;')).toEqual(['p', '->', 'q', '!=', 'r', ';']);
    expect(texts('i++ += --j;')).toEqual(['i', '++', '+=', '--', 'j', ';']);
  });

  it('不丢失任何非空白内容', () => {
    const source = [
      '#include <bits/stdc++.h>',
      'using namespace std;   // 常用头',
      'int main(){',
      '\tstring s = "a b\\"c";',
      "\tchar c = '\\\\';",
      "\tfor (int i = 0, j = n; i < j; ++i) cout << s[i] << c << 1'000 << endl;",
      '\t/* 块',
      '\t  注释 */',
      '\treturn 0 /* 尾注 */;',
      '}',
    ].join('\n');
    const joined = tokenizeCpp(source)
      .map((token) => token.text)
      .join('');
    expect(joined.replace(/\s+/g, '')).toBe(source.replace(/\s+/g, ''));
  });

  it('行列号可用于还原空行与注释位置', () => {
    const tokens = tokenizeCpp('int a;\n\nint b; // 尾注');
    expect(tokens[0]).toMatchObject({ column: 0, line: 0 });
    expect(tokens[3]).toMatchObject({ kind: 'keyword', line: 2 });
    expect(tokens[6]).toMatchObject({ kind: 'lineComment', line: 2 });
  });

  it('未闭合的引号不会吞掉整份文件', () => {
    const tokens = tokenizeCpp('int x = 1; // 忘了写 " 引号\nint y = 2;');
    expect(tokens.some((token) => token.text === 'y')).toBe(true);
  });
});
