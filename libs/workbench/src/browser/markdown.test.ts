import { describe, expect, it } from 'vitest';
import { escapeHtml, renderInlineMarkdown, renderMarkdown } from './markdown';

describe('escapeHtml', () => {
  it('转义全部 HTML 敏感字符', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('renderMarkdown', () => {
  it('渲染标题、段落与行内语法', () => {
    const html = renderMarkdown('# 题解\n\n这是 **重点** 与 *强调* 和 `代码`。');

    expect(html).toContain('<h1>题解</h1>');
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<em>强调</em>');
    expect(html).toContain('<code>代码</code>');
  });

  it('渲染无序列表与围栏代码块', () => {
    const html = renderMarkdown('- 第一步\n- 第二步\n\n```cpp\nint main() {}\n```');

    expect(html).toContain('<ul>');
    expect(html).toContain('<li>第一步</li>');
    expect(html).toContain('data-language="cpp"');
    expect(html).toContain('int main() {}');
  });

  it('渲染 GitHub 风格表格', () => {
    const html = renderMarkdown(
      '| 复杂度 | 值 |\n| --- | :--: |\n| 时间 | O(n) |\n| 空间 | O(1) |\n\n结束',
    );

    expect(html).toContain('<div class="oi-md-table"><table><thead><tr>');
    expect(html).toContain('</tbody></table></div>');
    expect(html).toContain('<th>复杂度</th>');
    expect(html).toContain('<th>值</th>');
    expect(html).toContain('<td>时间</td>');
    expect(html).toContain('<td>O(n)</td>');
    expect(html).toContain('<td>空间</td>');
    expect(html).toContain('<td>O(1)</td>');
    expect(html).toContain('<p>结束</p>');
  });

  it('有序列表保留编号并独立成列表', () => {
    const html = renderMarkdown('1. 读入\n2. 计算\n\n3. 结束');

    expect(html).toContain('<ol>');
    expect(html).toContain('<li>读入</li>');
    expect(html).toContain('<li>计算</li>');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<li>结束</li>');
    expect(html).not.toContain('<p>1. 读入</p>');
  });

  it('有序列表与无序列表互不嵌套', () => {
    const html = renderMarkdown('- 甲\n1. 乙\n- 丙');

    expect(html).toBe('<ul><li>甲</li></ul><ol><li>乙</li></ol><ul><li>丙</li></ul>');
  });

  it('围栏代码块不额外产生空行', () => {
    const html = renderMarkdown('```cpp\n#include <bits/stdc++.h>\nint main() {}\n```');

    expect(html).toBe(
      '<pre class="oi-md-code" data-language="cpp"><code>#include &lt;bits/stdc++.h&gt;\nint main() {}</code></pre>',
    );
  });

  it('未闭合的代码块照样输出正文', () => {
    const html = renderMarkdown('```\n第一行\n第二行');

    expect(html).toBe('<pre class="oi-md-code"><code>第一行\n第二行</code></pre>');
  });

  it('行内公式交给 KaTeX 渲染', () => {
    const html = renderMarkdown('如题，输入 $a+b$ 即可。');

    expect(html).toContain('class="katex"');
    expect(html).toContain('<annotation encoding="application/x-tex">a+b</annotation>');
    expect(html).toContain('如题，输入');
    expect(html).not.toContain('$a+b$');
  });

  it('$$ 独立块公式输出为块级并保留前后段落', () => {
    const html = renderMarkdown('前文\n\n$$\nn \\le 10^5\n$$\n\n后文');

    expect(html).toContain('<div class="oi-md-math">');
    expect(html).toContain('katex-display');
    expect(html).toContain('<annotation encoding="application/x-tex">n \\le 10^5</annotation>');
    expect(html).toContain('<p>前文</p>');
    expect(html).toContain('<p>后文</p>');
  });

  it('行内写的 $$…$$ 也按块级公式渲染', () => {
    const html = renderMarkdown('答案 $$a+b$$ 在此');

    expect(html).toContain('katex-display');
  });

  it('代码里的美元定界符不当公式处理', () => {
    const html = renderMarkdown('`$x$` 是字面量\n\n```\n$n \\le 10$\n```');

    expect(html).toContain('<code>$x$</code>');
    expect(html).toContain('$n \\le 10$');
    expect(html).not.toContain('katex');
  });

  it('字面 <br> 还原为换行元素，带属性写法与代码内仍按文本', () => {
    expect(renderMarkdown('第一行<br>第二行')).toBe('<p>第一行<br>第二行</p>');
    expect(renderMarkdown('第一行<br />第二行')).toBe('<p>第一行<br>第二行</p>');
    expect(renderMarkdown('写 `<br>` 即可')).toBe('<p>写 <code>&lt;br&gt;</code> 即可</p>');
    expect(renderMarkdown('别用 <br class="x">')).toContain('&lt;br class=&quot;x&quot;&gt;');
  });

  it('表格单元格里的 <br> 渲染成换行，样例保持逐行', () => {
    const html = renderMarkdown(
      '| Input | Output |\n| --- | --- |\n| 4 3<br>2 2 | 8 5<br>351025663 |',
    );

    expect(html).toContain('<td>4 3<br>2 2</td>');
    expect(html).toContain('<td>8 5<br>351025663</td>');
  });

  it('普通美元金额不会被误判成公式', () => {
    const html = renderMarkdown('花了 $5 和 $6 元');

    expect(html).toBe('<p>花了 $5 和 $6 元</p>');
  });

  it('连续两个美元金额不会被当成块级公式', () => {
    const html = renderMarkdown('价格 $$100 和 $$200 元');

    expect(html).not.toContain('katex');
  });

  it('\\(…\\) 与 \\[…\\] 定界符同样交给 KaTeX', () => {
    const html = renderMarkdown('行内 \\(a+b\\) 与块级 \\[a+b\\]');

    expect((html.match(/class="katex"/g) ?? []).length).toBe(2);
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\(');
  });

  it('矩阵里的 \\\\ 行分隔不被 Markdown 吃掉', () => {
    const html = renderMarkdown('$$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$$');

    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).toContain('<annotation encoding="application/x-tex">');
  });

  it('公式里的下标与星号不会被 Markdown 强调规则破坏', () => {
    const html = renderMarkdown('$a_{1,2} + b_{i\\,j}$ 与 $a^* + b_*$');

    expect((html.match(/class="katex"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<strong>');
  });

  it('公式与行内语法、表格、列表共存', () => {
    const html = renderMarkdown(
      '- 复杂度 $O(n\\log n)$\n\n| 项 | 值 |\n| --- | --- |\n| 上界 | $10^5$ |',
    );

    expect(html).toContain('<li>复杂度 <span class="katex">');
    expect(html).toContain('<td>上界</td>');
    expect(html).toContain('class="katex"');
  });

  it('LaTeX 写错时原式以错误态呈现，整篇继续渲染', () => {
    const html = renderMarkdown('错误 $\\frac{1}{$ 与后文');

    expect(html).toContain('katex-error');
    expect(html).toContain('与后文');
  });

  it('公式里的 \\href 不会被渲染成链接', () => {
    const html = renderMarkdown('$\\href{javascript:alert(1)}{x}$');

    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="javascript');
  });

  it('文本先转义，脚本不会进入输出', () => {
    const html = renderMarkdown('<script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('危险链接协议被降级为非链接文本', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('点我');
  });

  it('站外链接新窗口打开，避免劫持应用主窗口', () => {
    const html = renderMarkdown('[题面](https://codeforces.com/problemset/problem/1/A)');

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('站内锚点与相对链接不强制新窗口', () => {
    const html = renderMarkdown('[跳转](#section-2)');

    expect(html).toContain('<a href="#section-2"');
    expect(html).not.toContain('target="_blank"');
  });

  it('图片按白名单渲染为 img，非法协议降级为替代文本', () => {
    const html = renderMarkdown('![图一](https://cdn.example.com/a.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('alt="图一"');

    const blocked = renderMarkdown('![坏图](javascript:x)');
    expect(blocked).not.toContain('<img');
    expect(blocked).toContain('坏图');
  });

  it('图片不会被链接规则误处理，两者可并存', () => {
    const html = renderMarkdown('![图](https://x.test/a.png) [链](https://x.test/p)');

    expect(html).toContain('<img');
    expect(html).toContain('<a href="https://x.test/p"');
    // 不应残留未消费的 Markdown 感叹号
    expect(html).not.toContain('!<');
  });
});

describe('renderInlineMarkdown', () => {
  it('只出行内代码，不包段落', () => {
    const html = renderInlineMarkdown('单语句体与 if 同行：`if (x) continue;`');

    expect(html).toBe('单语句体与 if 同行：<code>if (x) continue;</code>');
  });

  it('示例里的尖括号与符号都按文本转义', () => {
    const html = renderInlineMarkdown('比较两侧空格：`i < n` 与 `a && b`');

    expect(html).toContain('<code>i &lt; n</code>');
    expect(html).toContain('<code>a &amp;&amp; b</code>');
    expect(html).not.toContain('<script');
  });

  it('注入内容只会作为文本出现', () => {
    expect(renderInlineMarkdown('`<img src=x onerror=alert(1)>`')).toBe(
      '<code>&lt;img src=x onerror=alert(1)&gt;</code>',
    );
  });
});
