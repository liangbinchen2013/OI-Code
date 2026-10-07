import { describe, expect, it } from 'vitest';
import {
  matchRemoteOjs,
  parseMemoryLimitKb,
  parseTimeLimitMs,
  pickStatementVersion,
  problemKey,
  toVjudgeVerdict,
  type IStatementVersion,
  type IVjudgeConfig,
  type IVjudgeRemoteOj,
} from './vjudge';

function oj(name: string, isAlive = true, languages: readonly string[] = []): IVjudgeRemoteOj {
  return {
    credentialTypes: ['browser_session'],
    homepage: `https://example.invalid/${name}`,
    isAlive,
    languages: languages.map((label, index) => ({ id: String(index), name: label })),
    name,
  };
}

const config: IVjudgeConfig = {
  remoteOjs: [
    oj('POJ', true, ['C++98 (MinGW GCC 4.4.0)', 'C99 (MinGW GCC 4.4.0)']),
    oj('CodeForces'),
    oj('CodeChef'),
    oj('Luogu'),
    oj('HDU'),
    oj('AtCoder'),
    oj('UniversalOJ'),
    oj('LibreOJ'),
    oj('FZU', false),
  ],
  statementLanguages: { en: 'English', ja: '日本語', zh: '中文' },
  version: 1791339536326,
};

function version(
  key: string,
  lang: string,
  type: string,
  at: number,
  flags: { readonly official?: boolean; readonly mainOfficial?: boolean } = {},
): IStatementVersion {
  return {
    key,
    lang,
    type,
    version: at,
    official: flags.official ?? false,
    mainOfficial: flags.mainOfficial ?? false,
  };
}

describe('problemKey', () => {
  it('拼出 OJ-题号 主键', () => {
    expect(problemKey('CodeForces', '1748E')).toBe('CodeForces-1748E');
  });
});

describe('matchRemoteOjs', () => {
  it('常见简称映射到规范名', () => {
    expect(matchRemoteOjs(config, 'CF')[0]?.name).toBe('CodeForces');
    expect(matchRemoteOjs(config, 'lg')[0]?.name).toBe('Luogu');
    expect(matchRemoteOjs(config, '洛谷')[0]?.name).toBe('Luogu');
    expect(matchRemoteOjs(config, 'uoj')[0]?.name).toBe('UniversalOJ');
  });

  it('大小写与空格不影响匹配，前缀匹配给出多个候选', () => {
    expect(matchRemoteOjs(config, ' CodeForces ')[0]?.name).toBe('CodeForces');
    expect(matchRemoteOjs(config, 'POJ')[0]?.name).toBe('POJ');
    const codeMatches = matchRemoteOjs(config, 'code').map((entry) => entry.name);
    expect(codeMatches).toContain('CodeForces');
    expect(codeMatches).toContain('CodeChef');
  });

  it('存活站点优先于同名已停站', () => {
    const withDead: IVjudgeConfig = { ...config, remoteOjs: [oj('FZU', false), oj('POJ')] };
    expect(matchRemoteOjs(withDead, 'p')[0]?.name).toBe('POJ');
  });

  it('空输入与无匹配返回空表', () => {
    expect(matchRemoteOjs(config, '')).toEqual([]);
    expect(matchRemoteOjs(config, '   ')).toEqual([]);
    expect(matchRemoteOjs(config, 'zzzz-not-an-oj')).toEqual([]);
  });

  it('候选数量受限且顺序稳定', () => {
    expect(matchRemoteOjs(config, 'o').length).toBeLessThanOrEqual(6);
  });
});

describe('toVjudgeVerdict', () => {
  it('映射已知状态码', () => {
    expect(toVjudgeVerdict('AC')).toBe('AC');
    expect(toVjudgeVerdict('wa')).toBe('WA');
    expect(toVjudgeVerdict('TLE')).toBe('TLE');
    expect(toVjudgeVerdict('MLE')).toBe('MLE');
    expect(toVjudgeVerdict('RE')).toBe('RE');
    expect(toVjudgeVerdict('CE')).toBe('CE');
  });

  it('PENDING 与非终态单独归类', () => {
    expect(toVjudgeVerdict('PENDING')).toBe('PENDING');
    expect(toVjudgeVerdict('RJ')).toBe('PENDING');
    expect(toVjudgeVerdict('')).toBe('PENDING');
  });

  it('Presentation Error 归为 WA，未知码不乐观当作 AC', () => {
    expect(toVjudgeVerdict('PE')).toBe('WA');
    expect(toVjudgeVerdict('SOME_NEW_CODE')).toBe('UNKNOWN');
  });
});

describe('pickStatementVersion', () => {
  const versions: readonly IStatementVersion[] = [
    version('316632928574981', 'zh', 'main', 1789906721000, { mainOfficial: true, official: true }),
    version('401313910919122', 'ja', 'translator', 1753452180000),
    version('400945453243432', 'en', 'translator', 1753327092000),
    version('366856660683060', 'en', 'translator', 1714578795000),
    version('386598219069603', 'zh', 'user', 1676099105000),
  ];

  it('优先官方主版本', () => {
    expect(pickStatementVersion(versions, 'zh')?.key).toBe('316632928574981');
  });

  it('同语言多译本取最新', () => {
    expect(pickStatementVersion(versions, 'en')?.key).toBe('400945453243432');
  });

  it('目标语言缺失时回退到主版本', () => {
    expect(pickStatementVersion(versions, 'ko')?.key).toBe('316632928574981');
  });

  it('空表返回 undefined', () => {
    expect(pickStatementVersion([], 'zh')).toBeUndefined();
  });
});

describe('限制解析', () => {
  it('时限统一折算成毫秒', () => {
    expect(parseTimeLimitMs('1000 ms')).toBe(1000);
    expect(parseTimeLimitMs('2 s')).toBe(2000);
    expect(parseTimeLimitMs('1 second')).toBe(1000);
    expect(parseTimeLimitMs('500')).toBe(500);
    expect(parseTimeLimitMs('2 秒')).toBe(2000);
    expect(parseTimeLimitMs(undefined)).toBeUndefined();
    expect(parseTimeLimitMs('—')).toBeUndefined();
  });

  it('内存统一折算成 KB', () => {
    expect(parseMemoryLimitKb('10000 kB')).toBe(10000);
    expect(parseMemoryLimitKb('256 MB')).toBe(262144);
    expect(parseMemoryLimitKb('1,024 KB')).toBe(1024);
    expect(parseMemoryLimitKb(undefined)).toBeUndefined();
  });
});
