import { describe, expect, it } from 'vitest';
import {
  matchRemoteOjs,
  pickDefaultLanguage,
  parseMemoryLimitKb,
  parseTimeLimitMs,
  pickStatementVersion,
  pickSubmitMethod,
  problemKey,
  remoteAccountsUrl,
  requiresRemoteBinding,
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

describe('pickDefaultLanguage', () => {
  // 洛谷真实语言表：第一项是 Pascal，直接取首项会选错
  const luogu: readonly { id: string; name: string }[] = [
    { id: '1', name: 'Pascal' },
    { id: '2', name: 'C' },
    { id: '3', name: 'C++98' },
    { id: '10', name: 'C++14' },
    { id: '5', name: 'Python3' },
  ];

  it('按编辑器语言择优匹配显示名', () => {
    expect(pickDefaultLanguage(luogu, 'cpp')).toBe('3');
    expect(pickDefaultLanguage(luogu, 'python')).toBe('5');
  });

  it('未知源语言或无匹配时退回首项', () => {
    expect(pickDefaultLanguage(luogu, undefined)).toBe('1');
    expect(pickDefaultLanguage(luogu, 'ruby')).toBe('1');
  });

  it('空表返回空串', () => {
    expect(pickDefaultLanguage([], 'cpp')).toBe('');
  });

  it('C++ 匹配不会误命中非 C++ 名称', () => {
    expect(pickDefaultLanguage([{ id: '0', name: 'Pascal' }], 'cpp')).toBe('0');
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

describe('pickSubmitMethod', () => {
  it('取第一个允许的提交方式', () => {
    expect(pickSubmitMethod([true, true, true])).toBe(0);
    expect(pickSubmitMethod([true, false, false])).toBe(0);
    // 洛谷关掉代提交：只能用用户已绑定的远端账号
    expect(pickSubmitMethod([false, true, true])).toBe(1);
    expect(pickSubmitMethod([false, false, true])).toBe(2);
  });

  it('全部不允许时返回 undefined', () => {
    expect(pickSubmitMethod([false, false, false])).toBeUndefined();
  });

  it('题面没给提交方式时按默认方式试', () => {
    expect(pickSubmitMethod([])).toBe(0);
  });
});

describe('requiresRemoteBinding', () => {
  it('区分"要绑定账号"与"根本没有提交方式"', () => {
    expect(requiresRemoteBinding([false, true, false])).toBe(true);
    expect(requiresRemoteBinding([false, false, true])).toBe(true);
    expect(requiresRemoteBinding([true, true, true])).toBe(false);
    expect(requiresRemoteBinding([false, false, false])).toBe(false);
    expect(requiresRemoteBinding([])).toBe(false);
  });
});

describe('remoteAccountsUrl', () => {
  it('按 OJ 生成绑定页地址并编码中文名', () => {
    expect(remoteAccountsUrl('洛谷')).toBe(
      'https://vjudge.net/user/remoteAccounts?oj=%E6%B4%9B%E8%B0%B7',
    );
    expect(remoteAccountsUrl(' POJ ')).toBe('https://vjudge.net/user/remoteAccounts?oj=POJ');
  });

  it('没有 OJ 时给总入口，不带空参数', () => {
    expect(remoteAccountsUrl('  ')).toBe('https://vjudge.net/user/remoteAccounts');
  });
});
