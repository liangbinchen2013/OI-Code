import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './vjudgeMarkdown';

describe('htmlToMarkdown', () => {
  it('整份文档只取 body，并丢弃脚本与样式', () => {
    const html = `<!DOCTYPE html><html><head><title>题面</title>
      <style>body { color: red }</style><script>alert(1)</script></head>
      <body><h2>描述</h2><p>内容</p></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('## 描述');
    expect(md).toContain('内容');
    expect(md).not.toContain('alert');
    expect(md).not.toContain('color: red');
    expect(md).not.toContain('题面');
  });

  it('标题层级与段落空行', () => {
    const md = htmlToMarkdown('<h1>输入</h1><p>第一段</p><p>第二段</p>');
    expect(md).toBe('# 输入\n\n第一段\n\n第二段');
  });

  it('行内标记：粗体、斜体、行内代码、链接、图片', () => {
    const md = htmlToMarkdown(
      '<p><b>粗</b> <em>斜</em> <code>a &lt; b</code> ' +
        '<a href="https://x.test/p">题面</a> <img src="https://x.test/a.png" alt="图"></p>',
    );
    expect(md).toContain('**粗**');
    expect(md).toContain('*斜*');
    expect(md).toContain('`a < b`');
    expect(md).toContain('[题面](https://x.test/p)');
    expect(md).toContain('![图](https://x.test/a.png)');
  });

  it('代码块保留换行与缩进', () => {
    const md = htmlToMarkdown(
      '<pre><code>int main() {\n    return 0;\n}\n</code></pre><p>后文</p>',
    );
    expect(md).toContain('```\nint main() {\n    return 0;\n}\n```');
    expect(md.endsWith('后文')).toBe(true);
  });

  it('表格转 Markdown 表格并转义竖线', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>n</th><th>m</th></tr><tr><td>1|2</td><td>3</td></tr></table>',
    );
    expect(md).toContain('| n | m |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| 1\\|2 | 3 |');
  });

  it('有序与无序列表按层级缩进', () => {
    const md = htmlToMarkdown(
      '<ul><li>甲</li><li>乙<ul><li>乙一</li></ul></li></ul>' +
        '<ol><li>第一</li><li>第二</li></ol>',
    );
    expect(md).toContain('- 甲');
    expect(md).toContain('  - 乙一');
    expect(md).toContain('1. 第一');
    expect(md).toContain('2. 第二');
  });

  it('引用块与换行', () => {
    const md = htmlToMarkdown('<blockquote>注意<br>第二行</blockquote>');
    expect(md).toContain('> 注意');
    expect(md).toContain('第二行');
  });

  it('MathJax 定界符转为 $ 与 $$', () => {
    const md = htmlToMarkdown('<p>当 \\(n \\le 10^5\\) 时</p><p>\\[ x = 1 \\]</p>');
    expect(md).toContain('$n \\le 10^5$');
    expect(md).toContain('$$\nx = 1\n$$');
  });

  it('HTML 实体与不间断空格', () => {
    const md = htmlToMarkdown('<p>1 &lt; 2 &amp; 3 &nbsp; x&#39;y &quot;z&quot; 10&minus;1</p>');
    expect(md).toContain('1 < 2 & 3');
    expect(md).toContain("x'y");
    expect(md).toContain('"z"');
  });

  it('未闭合标签与多余闭合标签不炸', () => {
    const md = htmlToMarkdown('<div><p>甲<div>乙</p></div></div>丙</p>');
    expect(md).toContain('甲');
    expect(md).toContain('乙');
    expect(md).toContain('丙');
  });

  it('空输入返回空串', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   \n  ')).toBe('');
  });

  it('输出不含三连空行与行尾空格', () => {
    const md = htmlToMarkdown('<p>甲   </p>\n\n\n<p>乙</p>');
    expect(md).not.toMatch(/\n{3,}/);
    expect(md).not.toMatch(/[ \t]$/m);
  });
});
