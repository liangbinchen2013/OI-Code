import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdown } from './markdown';

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
