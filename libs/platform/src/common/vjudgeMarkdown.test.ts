import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, statementTextToMarkdown } from './vjudgeMarkdown';

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

  it('<br> 转为硬换行标记而不是被并成空格', () => {
    expect(htmlToMarkdown('<p>第一行<br>第二行</p>')).toBe('第一行<br>第二行');
    expect(htmlToMarkdown('<p>第一行<br />第二行</p>')).toBe('第一行<br>第二行');
  });

  it('表格单元格里的 <br> 保住样例的逐行结构', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>Input</th><th>Output</th></tr>' +
        '<tr><td>4 3<br>2 2</td><td>8 5<br>351025663</td></tr></table>',
    );

    expect(md).toContain('| 4 3<br>2 2 | 8 5<br>351025663 |');
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

  it('正文片段里的 script/style 不会泄漏为可见文本', () => {
    const md = htmlToMarkdown(
      '<div><p>正文</p><script>var evil = 1;</script><style>p{color:red}</style><p>结尾</p></div>',
    );
    expect(md).toContain('正文');
    expect(md).toContain('结尾');
    expect(md).not.toContain('var evil');
    expect(md).not.toContain('color:red');
  });

  it('未闭合的 script 吞掉剩余内容，不产生文本', () => {
    expect(htmlToMarkdown('<p>正文</p><script>while(1){}')).toBe('正文');
  });

  it('代码块内的 MathJax 定界符保持原样', () => {
    const md = htmlToMarkdown(
      '<p>当 \\(n \\le 10\\) 时</p><pre><code>scanf(&quot;%d&quot;); \\(x+1\\)</code></pre>',
    );
    expect(md).toContain('$n \\le 10$');
    expect(md).toContain('\\(x+1\\)');
    expect(md).not.toContain('$x+1$');
  });

  it('&amp;lt; 双重转义只解一层', () => {
    expect(htmlToMarkdown('<p>&amp;lt;x&amp;gt;</p>')).toBe('&lt;x&gt;');
    expect(htmlToMarkdown('<p>&lt;x&gt;</p>')).toBe('<x>');
  });
});

describe('statementTextToMarkdown', () => {
  it('JSON 分节文档拆成标题与正文，不泄漏文档结构', () => {
    const json = JSON.stringify({
      lang: 'zh',
      trustable: true,
      sections: [
        { title: 'Background', value: { format: 'MD', content: '不能有多余的内容\n\n结尾' } },
        { title: 'Description', value: { format: 'MD', content: '输入 a, b，输出 a+b。' } },
      ],
    });
    const md = statementTextToMarkdown(json);

    expect(md).toBe(
      '## Background\n\n不能有多余的内容\n\n结尾\n\n## Description\n\n输入 a, b，输出 a+b。',
    );
    expect(md).not.toContain('sections');
    expect(md).not.toContain('\\n');
  });

  it('JSON 字符串里的 \\u 转义按原义解码，MD 正文不再当 HTML 处理', () => {
    const md = statementTextToMarkdown(
      '{"lang":"zh","sections":[{"title":"Description","value":' +
        '{"format":"MD","content":"a \\u003c b\\n\\n**粗**"}}]}',
    );

    expect(md).toBe('## Description\n\na < b\n\n**粗**');
  });

  it('正文自带标题时不叠加分节标题', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          { title: 'Description', value: { format: 'MD', content: '## 题目描述\n\n正文' } },
        ],
      }),
    );

    expect(md).toBe('## 题目描述\n\n正文');
  });

  it('format 为 HTML 的分节仍走 HTML 转换', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          {
            title: 'Input',
            value: { format: 'HTML', content: '<p>两个整数 <code>a</code>、<code>b</code></p>' },
          },
        ],
      }),
    );

    expect(md).toBe('## Input\n\n两个整数 `a`、`b`');
  });

  it('value 为纯字符串时按是否含标签决定转换方式', () => {
    expect(
      statementTextToMarkdown(
        JSON.stringify({ sections: [{ title: 'Hint', value: '<p>提示</p>' }] }),
      ),
    ).toBe('## Hint\n\n提示');
  });

  it('JSON 文档被包在 HTML 正文里时先剥壳再分节', () => {
    const inner = JSON.stringify({
      sections: [{ title: 'Description', value: { format: 'MD', content: '正文' } }],
    });

    expect(statementTextToMarkdown(`<html><body>${inner}</body></html>`)).toBe(
      '## Description\n\n正文',
    );
  });

  it('HTML 题面保持原有行为', () => {
    expect(statementTextToMarkdown('<h2>描述</h2><p>内容</p>')).toBe('## 描述\n\n内容');
  });

  it('MD 正文夹带的 HTML 只归一标签，段落分隔不丢', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          {
            title: 'Background',
            value: {
              format: 'MD',
              content: '第一段\n\n请看 <b>这里</b>。\n\n<div class="md">独立说明</div>',
            },
          },
        ],
      }),
    );

    expect(md).toBe('## Background\n\n第一段\n\n请看 **这里**。\n\n独立说明');
  });

  it('MD 代码块内的 HTML 原样保留', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          { title: 'Sample', value: { format: 'MD', content: '```html\n<div>原样</div>\n```' } },
        ],
      }),
    );

    expect(md).toBe('## Sample\n\n```html\n<div>原样</div>\n```');
  });

  it('标为 MD 的整段 HTML 按标签切段，不会挤成一行', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          { title: 'Description', value: { format: 'MD', content: '<p>段一</p><p>段二</p>' } },
        ],
      }),
    );

    expect(md).toBe('## Description\n\n段一\n\n段二');
  });

  it('MD 正文里的 <br/> 归一为硬换行标记', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [{ title: 'Sample', value: { format: 'MD', content: '第一行<br/>第二行' } }],
      }),
    );

    expect(md).toBe('## Sample\n\n第一行<br>第二行');
  });

  it('MD 正文里的 HTML 链接与图片转成 Markdown', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          {
            title: 'Link',
            value: {
              format: 'MD',
              content:
                '见 <a href="https://x.test/p">题面</a> 与 <img src="https://x.test/a.png" alt="图">',
            },
          },
        ],
      }),
    );

    expect(md).toContain('[题面](https://x.test/p)');
    expect(md).toContain('![图](https://x.test/a.png)');
  });

  it('非标签的尖括号正文不被当标签吃掉', () => {
    const md = statementTextToMarkdown(
      JSON.stringify({
        sections: [
          { title: 'Description', value: { format: 'MD', content: '当 a < b 且 b > 0 时' } },
        ],
      }),
    );

    expect(md).toBe('## Description\n\n当 a < b 且 b > 0 时');
  });

  it('没有可用分节时原样返回，不伪造标题', () => {
    expect(statementTextToMarkdown('{"sections":[]}')).toBe('{"sections":[]}');
  });
});
