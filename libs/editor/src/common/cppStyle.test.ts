import { describe, expect, it } from 'vitest';
import { analyzeCppStyle, DEFAULT_CPP_STYLE } from './cppStyle';

const TYPICAL = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    if (n > 0) {
        cout << n << endl;
    } else {
        cout << 0 << endl;
    }
    for (int i = 0; i < n; i++) {
        int x = i * 2 + 1;
        cout << x << " ";
    }
    return 0;
}
`;

const COMPACT = `#include<bits/stdc++.h>
using namespace std;
int main(){
	int n;cin>>n;
	if(n>0) cout<<n<<endl;
	else cout<<0<<endl;
	for(int i=0;i<n;i++){
		int x=i*2+1;
		printf("%d %d",x,i);
	}
	return 0;
}
`;

const ALLMAN = `int f(int a)
{
    if (a > 0)
    {
        return a;
    }
    else
    {
        return -a;
    }
}
`;

describe('analyzeCppStyle', () => {
  it('识别常见的 OI 风格', () => {
    const { style } = analyzeCppStyle(TYPICAL);

    expect(style.indentWithTabs).toBe(false);
    expect(style.indentWidth).toBe(4);
    expect(style.braceNextLine).toBe(false);
    expect(style.spaceAfterControlKeyword).toBe(true);
    expect(style.spaceInsideParens).toBe(false);
    expect(style.spaceAroundBinaryOperator).toBe(true);
    expect(style.spaceAfterComma).toBe(true);
    expect(style.spaceAfterSemicolon).toBe(true);
    expect(style.elseSameLine).toBe(true);
    expect(style.singleStatementOnSameLine).toBe(false);
  });

  it('识别紧凑 + Tab 缩进风格', () => {
    const { style } = analyzeCppStyle(COMPACT);

    expect(style.indentWithTabs).toBe(true);
    expect(style.spaceAfterControlKeyword).toBe(false);
    expect(style.spaceAroundBinaryOperator).toBe(false);
    expect(style.spaceAfterComma).toBe(false);
    expect(style.spaceAfterSemicolon).toBe(false);
    expect(style.braceNextLine).toBe(false);
    // `if(n>0) cout<<n<<endl;` 单语句体同行
    expect(style.singleStatementOnSameLine).toBe(true);
    // 样本里没有 `}` 后接 else 的写法，保持默认而不是瞎猜
    expect(style.elseSameLine).toBe(DEFAULT_CPP_STYLE.elseSameLine);
  });

  it('识别 Allman 花括号', () => {
    const { style } = analyzeCppStyle(ALLMAN);

    expect(style.braceNextLine).toBe(true);
    expect(style.elseSameLine).toBe(false);
    expect(style.spaceAfterControlKeyword).toBe(true);
  });

  it('两空格缩进', () => {
    const { style } = analyzeCppStyle(
      'int main() {\n  if (a) {\n    f(a, b);\n  }\n  return 0;\n}\n',
    );

    expect(style.indentWidth).toBe(2);
    expect(style.indentWithTabs).toBe(false);
  });

  it('区分 int* p 与 int *p', () => {
    expect(
      analyzeCppStyle('int main() {\n    int* p = &x;\n    int* q = p;\n}').style
        .attachPointerToType,
    ).toBe(true);
    expect(
      analyzeCppStyle('int main() {\n    int *p = &x;\n    int *q = p;\n}').style
        .attachPointerToType,
    ).toBe(false);
  });

  it('样本越典型置信度越高', () => {
    const typical = analyzeCppStyle(TYPICAL);
    const compact = analyzeCppStyle(COMPACT);

    expect(typical.confidence).toBeGreaterThan(0.6);
    expect(compact.confidence).toBeGreaterThan(0.6);
    expect(typical.evidence.length).toBeGreaterThan(3);
  });

  it('样本太少时回落默认值且置信度低', () => {
    const analysis = analyzeCppStyle('int x;');

    expect(analysis.style).toEqual(DEFAULT_CPP_STYLE);
    expect(analysis.confidence).toBeLessThan(0.5);
    expect(analysis.indentedLines).toBe(0);
  });

  it('空行上限按样本观察值', () => {
    expect(analyzeCppStyle(TYPICAL).style.maxBlankLines).toBe(1);
    expect(analyzeCppStyle('int a;\n\n\nint b;\n').style.maxBlankLines).toBe(2);
  });
});
