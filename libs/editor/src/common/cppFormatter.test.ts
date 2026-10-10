import { describe, expect, it } from 'vitest';
import { tokenizeCpp } from './cppLexer';
import { analyzeCppStyle, DEFAULT_CPP_STYLE, type ICppStyle } from './cppStyle';
import { formatCpp } from './cppFormatter';

const COMPACT: ICppStyle = {
  ...DEFAULT_CPP_STYLE,
  elseSameLine: false,
  indentWithTabs: true,
  singleStatementOnSameLine: true,
  spaceAfterComma: false,
  spaceAfterControlKeyword: false,
  spaceAfterSemicolon: false,
  spaceAroundArithmetic: false,
  spaceAroundAssignment: false,
  spaceAroundBitwise: false,
  spaceAroundComparison: false,
  spaceAroundConditional: false,
  spaceAroundLogical: false,
  spaceAroundLeftShift: false,
  spaceAroundRightShift: false,
  spaceBeforeBrace: false,
};

/** 真实 OIer 写法：格式化后应当原样不动。 */
const USER_SAMPLE = `#include <bits/stdc++.h>
using namespace std;
int n,m,a[100005];
vector<int> g[200005];
int main(){
  int t; cin >> t;
  while(t--){
    cin >> n >> m;
    vector<int> a(n+1);
    for(int i=1;i<=n;i++) cin >> a[i];
    for(int i=0;i<m;i++){int u,v;cin>>u>>v;g[u].push_back(v);}
    scanf("%d %d",&n,&m);
    for(int i=0;i<n;i++) for(int j=0;j<m;j++) cin >> b[i][j];
  }
}
`;

/** token 序列一致 = 没有增删或改写任何代码内容。 */
function fingerprint(source: string): string {
  return tokenizeCpp(source)
    .map((token) => token.text)
    .join('·');
}

function show(source: string, style: ICppStyle): string {
  return formatCpp(source, style).formatted;
}

describe('formatCpp', () => {
  it('把紧凑代码整理成典型风格', () => {
    const output = show(
      'int main(){int n;cin>>n;if(n>0)cout<<n<<endl;return 0;}\n',
      DEFAULT_CPP_STYLE,
    );

    expect(output).toBe(
      [
        'int main() {',
        '    int n;',
        '    cin >> n;',
        '    if (n > 0)',
        '        cout << n << endl;',
        '    return 0;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('把典型代码整理成紧凑风格', () => {
    const output = show(
      'int main() {\n    int n;\n    if (n > 0) {\n        cout << n;\n    } else {\n        cout << 0;\n    }\n}\n',
      COMPACT,
    );

    expect(output.split('\n')[0]).toBe('int main(){');
    expect(output).toContain('if(n>0){');
    expect(output).toContain('cout<<n;');
    expect(output).toContain('}\n\telse{');
  });

  it('Allman 风格把花括号提到行首', () => {
    const output = show('int f(int a) {\n    if (a > 0) { return a; }\n    return 0;\n}\n', {
      ...DEFAULT_CPP_STYLE,
      braceNextLine: true,
    });

    expect(output).toContain('int f(int a)\n{');
    expect(output).toContain('if (a > 0)\n    {');
  });

  it('幂等：格式化两次结果一致', () => {
    const source = [
      '#include <bits/stdc++.h>',
      'using namespace std;',
      'int main(){vector<vector<int>> g;map<string,int> mp;',
      'for(int i=0;i<n;i++){for(int j=0;j<m;j++) g[i][j]=i*j+1;}',
      'sort(v.begin(),v.end(),[](int a,int b){return a>b;});',
      'switch(x){case 1:f();break;default:break;}',
      'int *p=new int[4];int* q=p;auto r=-5;bool ok=!(a&&b);',
      'return 0;}',
    ].join('\n');
    for (const style of [DEFAULT_CPP_STYLE, COMPACT]) {
      const once = show(source, style);
      expect(show(once, style)).toBe(once);
    }
  });

  it('不改变任何 token 内容', () => {
    const source = [
      '#include <bits/stdc++.h>',
      'using namespace std; // 头文件',
      '/* 块',
      '注释 */',
      'int main(){',
      '\tstring s="a b\\"c";char c=\'\\n\';',
      '\tfor(int i=0,j=n;i<j;++i){printf("%d %d\\n",i,j);}',
      '\tif(a<b&&c>=d) f(g(x),h(y));',
      '\treturn 0;',
      '}',
    ].join('\n');
    for (const style of [DEFAULT_CPP_STYLE, COMPACT]) {
      expect(fingerprint(show(source, style))).toBe(fingerprint(source));
    }
  });

  it('不增删花括号，单语句体按风格摆放', () => {
    const bracedless = 'int main(){\nif(x) f();\nreturn 0;\n}\n';
    expect(show(bracedless, DEFAULT_CPP_STYLE)).toContain('if (x)\n        f();');
    expect(show(bracedless, COMPACT)).toContain('if(x) f();');
    expect(show(bracedless, DEFAULT_CPP_STYLE)).not.toContain('{ f();');
  });

  it('预处理行与注释位置保留', () => {
    const output = show('#include <iostream>\nint x; // 说明\nint y;\n', DEFAULT_CPP_STYLE);

    expect(output.split('\n')[0]).toBe('#include <iostream>');
    expect(output).toContain('int x; // 说明');
  });

  it('模板实参两侧不加空格', () => {
    const output = show('vector<vector<int>> a;pair<int,char> p;\n', DEFAULT_CPP_STYLE);

    expect(output).toBe('vector<vector<int>> a;\npair<int, char> p;\n');
  });

  it('switch 的 case 比语句少缩进一层', () => {
    const output = show(
      'int main(){switch(x){case 1:f();break;default:break;}}\n',
      DEFAULT_CPP_STYLE,
    );

    expect(output).toContain('    switch (x) {');
    expect(output).toContain('        case 1:');
    expect(output).toContain('            f();');
    expect(output).toContain('        default:');
  });

  it('lambda 与初始化列表保持内联', () => {
    const output = show('sort(a,a+n,[](int x,int y){return x>y;});\n', DEFAULT_CPP_STYLE);

    expect(output).toBe('sort(a, a + n, [](int x, int y) { return x > y; });\n');
  });

  it('指针星号按风格摆放', () => {
    const source = 'int main(){int*p=a;int*q=b;return 0;}\n';

    expect(show(source, DEFAULT_CPP_STYLE)).toContain('int *p = a;');
    expect(show(source, { ...DEFAULT_CPP_STYLE, attachPointerToType: true })).toContain(
      'int* p = a;',
    );
  });

  it('括号不配对时保持原样', () => {
    const broken = 'int main(){ if(x{ }\n';
    const outcome = formatCpp(broken, DEFAULT_CPP_STYLE);

    expect(outcome.skipped).toBe(true);
    expect(outcome.formatted).toBe(broken);
  });

  it('连续空行按风格上限压缩', () => {
    const output = show('int a;\n\n\n\nint b;\n', { ...DEFAULT_CPP_STYLE, maxBlankLines: 1 });

    expect(output).toBe('int a;\n\nint b;\n');
  });

  it('用户的真实写法保持行结构，只补齐少数空格', () => {
    const style = analyzeCppStyle(USER_SAMPLE).style;
    const output = show(USER_SAMPLE, style);

    // 行数一致 = 没有把一行多语句或整块一行拆开
    expect(output.split('\n').length).toBe(USER_SAMPLE.split('\n').length);
    expect(output).toContain('int n,m,a[100005];');
    expect(output).toContain('  int t; cin >> t;');
    expect(output).toContain('    vector<int> a(n+1);');
    expect(output).toContain('    for(int i=1;i<=n;i++) cin >> a[i];');
    expect(output).toContain('    for(int i=0;i<m;i++){int u,v;cin >> u >> v;g[u].push_back(v);}');
    expect(output).toContain('    scanf("%d %d",&n,&m);');
    expect(output).toContain('    for(int i=0;i<n;i++) for(int j=0;j<m;j++) cin >> b[i][j];');
    expect(show(output, style)).toBe(output);
  });

  it('紧凑习惯关掉时把一行多语句与整块一行拆开', () => {
    const style: ICppStyle = {
      ...analyzeCppStyle(USER_SAMPLE).style,
      allowMultipleStatementsPerLine: false,
      allowShortBlocksOnOneLine: false,
    };
    const output = show(USER_SAMPLE, style);

    expect(output).toContain('  int t;\n  cin >> t;');
    expect(output).not.toContain('{int u,v;');
    expect(output.split('\n')).toContain('      int u,v;');
  });

  it('for 头里的分号不会把语句拆成多行', () => {
    expect(show('int main(){for(int i=0;i<n;i++) f(i);}\n', COMPACT)).toContain(
      'for(int i=0;i<n;i++) f(i);',
    );
  });

  it('三目运算符按风格摆放', () => {
    expect(show('int main(){y=a?b:c;return 0;}\n', DEFAULT_CPP_STYLE)).toContain('y = a ? b : c;');
    expect(show('int main(){y=a?b:c;return 0;}\n', COMPACT)).toContain('y=a?b:c;');
  });

  it('case 标签缩进跟随风格', () => {
    const dedented = { ...DEFAULT_CPP_STYLE, indentCaseLabels: false };
    const output = show('int main(){switch(x){case 1:f();break;}}\n', dedented);

    expect(output).toContain('    switch (x) {');
    expect(output).toContain('    case 1:');
    expect(output).toContain('        f();');
  });

  it('保留 BOM 与 CRLF', () => {
    const output = show('\uFEFFint main(){int x;}\r\n', COMPACT);

    expect(output.startsWith('\uFEFF')).toBe(true);
    expect(output).toContain('\r\n');
  });
});
