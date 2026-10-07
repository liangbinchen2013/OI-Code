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
});
