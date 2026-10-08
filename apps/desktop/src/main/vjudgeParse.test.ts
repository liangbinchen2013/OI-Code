import { parseMemoryLimitKb, parseTimeLimitMs } from '@oi/platform';
import { describe, expect, it } from 'vitest';
import {
  parseMySubmissions,
  parseProblemPageData,
  parseRemoteOjs,
  parseStatementVersions,
  parseSubmission,
  parseSolvedRecords,
  readProperty,
} from './vjudgeParse';

/** 取自 /util/cfg 的真实片段（字段与大小写保持一致）。 */
const cfgFixture = {
  remoteOJs: {
    POJ: {
      credentialTypes: ['browser_session', 'username_password'],
      faviconUrl: 'POJ_favicon.gif',
      homepage: 'http://poj.org',
      isAlive: true,
      languages: {
        '0': 'C++98 (MinGW GCC 4.4.0)',
        '1': 'C99 (MinGW GCC 4.4.0)',
        '2': 'Java (JDK 6)',
      },
      name: 'POJ',
    },
    FZU: {
      credentialTypes: [],
      homepage: 'https://oj.fzu.edu.cn',
      isAlive: false,
      languages: {},
    },
  },
};

describe('parseRemoteOjs', () => {
  it('解析语言表与存活标记，并按名称排序', () => {
    const ojs = parseRemoteOjs(cfgFixture.remoteOJs);
    expect(ojs.map((oj) => oj.name)).toEqual(['FZU', 'POJ']);
    const poj = ojs[1];
    expect(poj?.isAlive).toBe(true);
    expect(poj?.credentialTypes).toContain('username_password');
    expect(poj?.languages).toEqual([
      { id: '0', name: 'C++98 (MinGW GCC 4.4.0)' },
      { id: '1', name: 'C99 (MinGW GCC 4.4.0)' },
      { id: '2', name: 'Java (JDK 6)' },
    ]);
  });

  it('缺失 name 时回退到对象键，非对象输入返回空表', () => {
    expect(parseRemoteOjs(cfgFixture.remoteOJs)[0]?.name).toBe('FZU');
    expect(parseRemoteOjs(undefined)).toEqual([]);
    expect(parseRemoteOjs([])).toEqual([]);
  });
});

describe('parseProblemPageData', () => {
  it('取出隐藏 textarea 中的题目状态', () => {
    const html = `<div>正文</div><textarea style="display: none" name="dataJson">{"oj":"POJ","prob":"1182","problemId":14789,"username":"tester"}</textarea>`;
    expect(parseProblemPageData(html)).toEqual({
      oj: 'POJ',
      prob: '1182',
      problemId: 14789,
      username: 'tester',
    });
  });

  it('实体转义过的 JSON 也能解析', () => {
    const html =
      '<textarea name="dataJson">{"properties":[{"title":"time_limit","content":"1000 ms"}],"a":"&lt;x&gt;"}</textarea>';
    const data = parseProblemPageData(html);
    expect(readProperty(data ?? {}, 'time_limit')).toBe('1000 ms');
    expect(data?.['a']).toBe('<x>');
  });

  it('无 dataJson 或 JSON 损坏时返回 undefined', () => {
    expect(parseProblemPageData('<div>nothing</div>')).toBeUndefined();
    expect(parseProblemPageData('<textarea name="dataJson">{坏数据</textarea>')).toBeUndefined();
  });
});

describe('题面版本与限制解析', () => {
  const descBriefs = [
    {
      author: 'System',
      key: '316632928574981',
      lang: 'zh',
      mainOfficial: true,
      official: true,
      remarks: 'Initialization.',
      type: 'main',
      version: 1789906721000,
    },
    {
      author: 'DeepSeek',
      key: '401313910919122',
      lang: 'ja',
      mainOfficial: false,
      official: false,
      type: 'translator',
      version: 1753452180000,
    },
    { lang: 'en', type: 'translator' },
  ];

  it('忽略缺 key 的条目', () => {
    const versions = parseStatementVersions(descBriefs);
    expect(versions.map((version) => version.key)).toEqual(['316632928574981', '401313910919122']);
    expect(versions[0]?.remarks).toBe('Initialization.');
  });

  it('接受页面里的数字 key（真实题面版本键是数字字面量）', () => {
    const versions = parseStatementVersions([
      {
        key: 316632928574981,
        lang: 'zh',
        mainOfficial: true,
        official: true,
        type: 'main',
        version: 1789906721000,
      },
    ]);
    expect(versions.map((version) => version.key)).toEqual(['316632928574981']);
  });

  it('properties 提供时限与内存并可归一', () => {
    const data = {
      properties: [
        { title: 'time_limit', content: '1000 ms' },
        { title: 'mem_limit', content: '10000 kB' },
        { title: 'source', content: '<div>Noi 01</div>' },
      ],
    };
    expect(parseTimeLimitMs(readProperty(data, 'time_limit'))).toBe(1000);
    expect(parseMemoryLimitKb(readProperty(data, 'mem_limit'))).toBe(10000);
    expect(readProperty(data, 'missing')).toBeUndefined();
  });
});

describe('判题结果解析', () => {
  /** 实测响应：判题中。 */
  const pendingPayload = {
    author: 'tester',
    code: true,
    editable: false,
    hasSubmissionOriginViewer: true,
    isOpen: 1,
    language: 'C++98 (MinGW GCC 4.4.0)',
    length: 1737,
    memory: 0,
    oj: 'POJ',
    processing: true,
    probNum: '1182',
    refreshing: true,
    remoteRunId: '25215486',
    runId: 73166362,
    status: 'Submitted',
    statusCanonical: 'PENDING',
    statusType: 2,
    submitTime: 1791380164000,
  };

  it('保留非终态标记与远端提交号', () => {
    const submission = parseSubmission(73166362, pendingPayload);
    expect(submission.processing).toBe(true);
    expect(submission.statusCanonical).toBe('PENDING');
    expect(submission.remoteRunId).toBe('25215486');
    expect(submission.language).toBe('C++98 (MinGW GCC 4.4.0)');
    expect(submission.code).toBeUndefined();
  });

  it('终态时给出耗时与内存', () => {
    const submission = parseSubmission(73166362, {
      ...pendingPayload,
      memory: 632,
      processing: false,
      refreshing: false,
      runtime: 50,
      status: 'Accepted',
      statusCanonical: 'AC',
      statusType: 0,
    });
    expect(submission.runtimeMs).toBe(50);
    expect(submission.memoryKb).toBe(632);
    expect(submission.statusCanonical).toBe('AC');
    expect(submission.processing).toBe(false);
  });

  it('showCode 时 code 为源码字符串', () => {
    expect(parseSubmission(1, { code: 'int main(){}' }).code).toBe('int main(){}');
  });

  it('数字型 remoteRunId 转字符串，异常输入不崩', () => {
    expect(parseSubmission(1, { remoteRunId: 42 }).remoteRunId).toBe('42');
    expect(parseSubmission(9, 'not-an-object').runId).toBe(9);
    expect(parseSubmission(9, undefined).processing).toBe(false);
  });
});

describe('提交摘要与记录', () => {
  it('解析 mySols 元组数组', () => {
    expect(parseMySubmissions([[73166362, 'Accepted', 1791380164000, 'accepted', 'AC']])).toEqual([
      {
        runId: 73166362,
        status: 'Accepted',
        statusCanonical: 'AC',
        submitTime: 1791380164000,
      },
    ]);
    expect(parseMySubmissions([['坏数据'], 5])).toEqual([]);
  });

  it('摊平 acRecords 为 OJ-题号', () => {
    expect(parseSolvedRecords({ POJ: ['1182', '1000'], HDU: ['1001'] })).toEqual([
      'HDU-1001',
      'POJ-1000',
      'POJ-1182',
    ]);
    expect(parseSolvedRecords(undefined)).toEqual([]);
  });
});
