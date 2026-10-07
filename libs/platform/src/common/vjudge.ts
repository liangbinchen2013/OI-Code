import type { Event } from '@oi/base';
import type { JudgeVerdict } from './judge';
import { createDecorator } from './instantiation';

/** VJudge 站点地址：题面、配置与记录类接口均可匿名访问，提交与题目页需登录。 */
export const VJUDGE_BASE_URL = 'https://vjudge.net';

/**
 * 内置浏览器持久化分区：站点登录态 Cookie 存放在此。
 * VJudge 等外部服务在主进程复用该分区，应用自身不保存任何账号密码。
 */
export const OI_CODE_BROWSER_PARTITION = 'persist:oi-code-browser';

/** 一个可选的提交语言（id 由各远端 OJ 自行编号，不可跨 OJ 复用）。 */
export interface IVjudgeLanguageOption {
  readonly id: string;
  readonly name: string;
}

/** `/util/cfg` 中的单个远端 OJ 描述。 */
export interface IVjudgeRemoteOj {
  /** 规范名，如 `CodeForces`。 */
  readonly name: string;
  readonly homepage: string;
  readonly isAlive: boolean;
  readonly languages: readonly IVjudgeLanguageOption[];
  /** 该 OJ 支持的凭据类型，如 `browser_session`、`username_password`。 */
  readonly credentialTypes: readonly string[];
}

/** 全局配置快照，来自 `GET /util/cfg`。 */
export interface IVjudgeConfig {
  /** 站点配置版本号（毫秒时间戳），用于缓存失效判断。 */
  readonly version: number;
  readonly remoteOjs: readonly IVjudgeRemoteOj[];
  /** 题面语言码 → 本地名，如 `zh` → `中文`。 */
  readonly statementLanguages: Readonly<Record<string, string>>;
}

/** 题目的一份题面版本（官方抓取、LLM 翻译或用户改写）。 */
export interface IStatementVersion {
  /** 题面键：`GET /problem/description/{key}` 的路径参数。 */
  readonly key: string;
  readonly lang: string;
  /** `main` 官方抓取 / `translator` LLM 翻译 / `user` 用户改写。 */
  readonly type: string;
  readonly author?: string;
  /** 该版本的更新时间戳。 */
  readonly version: number;
  readonly official: boolean;
  readonly mainOfficial: boolean;
  readonly remarks?: string;
}

/** 题目在 VJudge 上的一次提交摘要（题目页 `mySols` 字段）。 */
export interface IVjudgeSubmissionBrief {
  readonly runId: number;
  readonly status: string;
  readonly submitTime: number;
  readonly statusCanonical: string;
}

/** 一道题的完整可展示信息。 */
export interface IVjudgeProblem {
  readonly oj: string;
  readonly probNum: string;
  /** VJudge 内部题号。 */
  readonly problemId: number;
  readonly title: string;
  /** 题面正文（已由 HTML 转为 Markdown）。 */
  readonly markdown: string;
  readonly statements: readonly IStatementVersion[];
  /** 当前展示题面使用的版本键。 */
  readonly statementKey: string;
  readonly timeLimitMs?: number;
  readonly memoryLimitKb?: number;
  /** 三种提交方式（`method` 0/1/2）是否可用。 */
  readonly submitMethods: readonly boolean[];
  readonly mySubmissions: readonly IVjudgeSubmissionBrief[];
  readonly remoteUrl?: string;
}

/** 提交请求。 */
export interface IVjudgeSubmitRequest {
  readonly oj: string;
  readonly probNum: string;
  /** 语言 id，取自 {@link IVjudgeRemoteOj.languages}。 */
  readonly language: string;
  readonly source: string;
  /** 0 = VJudge 服务账号；1/2 = 使用绑定的远端账号。 */
  readonly method?: number;
  /** 记录可见性，缺省沿用站点默认。 */
  readonly open?: number;
  readonly bindingId?: number;
}

/** 一次提交的判题结果快照。 */
export interface IVjudgeSubmission {
  readonly runId: number;
  readonly oj: string;
  readonly probNum: string;
  /** 展示用状态文本，如 `Accepted`。 */
  readonly status: string;
  /** 机器可读状态码，如 `AC`、`PENDING`。 */
  readonly statusCanonical: string;
  /** 结果未定时为 true，需继续轮询。 */
  readonly processing: boolean;
  readonly language?: string;
  readonly runtimeMs?: number;
  readonly memoryKb?: number;
  readonly remoteRunId?: string;
  readonly submitTime?: number;
  /** `showCode` 为真时带回的源码。 */
  readonly code?: string;
}

/** 用户在 VJudge 上的通过记录。 */
export interface IVjudgeSolvedProblems {
  /** 已 AC 的题目键集合，形如 `POJ-1182`。 */
  readonly accepted: readonly string[];
  /** 有失败记录但未通过的题目键。 */
  readonly failed: readonly string[];
}

/** 当前 VJudge 账号状态。 */
export interface IVjudgeAccount {
  readonly loggedIn: boolean;
  readonly username?: string;
  /** 已 AC 题目数，未登录或未取到时缺省。 */
  readonly acceptedCount?: number;
}

/** 判题结果映射：站点状态码 → 应用判定（含非终态与未知）。 */
export type VjudgeVerdict = JudgeVerdict | 'PENDING' | 'UNKNOWN';

/**
 * VJudge 服务契约：配置、题面、提交与结果爬取。
 * 网络请求全部在 Code 层执行，渲染进程只经 {@link IVjudgeServiceClient} 调用。
 */
export interface IVjudgeService {
  /** 判题结果更新（主进程后台轮询产生；渲染进程侧为 RPC 通知转发）。 */
  readonly onDidSubmissionUpdate: Event<IVjudgeSubmission>;
  /** 取全局配置（OJ 列表、语言表、题面语言枚举），实现侧应缓存。 */
  getConfig(): Promise<IVjudgeConfig>;
  /** 探测登录态；用户名在成功取过题目后会被缓存。 */
  getAccount(): Promise<IVjudgeAccount>;
  /** 拉取题面并转为 Markdown；未登录会抛错（题目页需登录态）。 */
  fetchProblem(oj: string, probNum: string, lang?: string): Promise<IVjudgeProblem>;
  /** 提交代码，返回 VJudge 侧提交号。 */
  submit(request: IVjudgeSubmitRequest): Promise<number>;
  /** 单次查询提交结果。 */
  getSubmission(runId: number, showCode?: boolean): Promise<IVjudgeSubmission>;
  /** 开始自动爬取该提交直到终态；结果经事件上报。 */
  watch(runId: number): Promise<void>;
  /** 停止爬取。 */
  unwatch(runId: number): Promise<void>;
  /** 取用户的通过记录（匿名可用）。 */
  getSolvedProblems(username: string): Promise<IVjudgeSolvedProblems>;
}

/**
 * 渲染进程侧的 VJudge 服务：契约与主进程侧一致，
 * 事件由主进程的通知转发而来。
 */
export type IVjudgeServiceClient = IVjudgeService;

export const IVjudgeService = createDecorator<IVjudgeService>('vjudgeService');

/** 拼题目主键，形如 `CodeForces-1748E`。 */
export function problemKey(oj: string, probNum: string): string {
  return `${oj}-${probNum}`;
}

/** 站点常见简称与中文名的补充别名表。 */
const OJ_ALIASES: Readonly<Record<string, readonly string[]>> = {
  CodeForces: ['cf', 'codeforce', 'codeforces'],
  Luogu: ['lg', '洛谷'],
  AtCoder: ['ac', 'atcoder'],
  UniversalOJ: ['uoj'],
  LibreOJ: ['loj'],
  HYSBZ: ['bzoj', '神犇'],
  黑暗爆炸: ['heian', 'bzoj'],
  Baekjoon: ['boj', '백준', '韩国'],
  计蒜客: ['jisuanke', 'jsk'],
  牛客: ['nowcoder', 'nk'],
  代码源: ['daimayuan'],
  OpenJudge: ['oj'],
  UVA: ['uva'],
  SPOJ: ['spoj'],
  HDU: ['hdu', '杭电'],
  POJ: ['poj'],
  ZOJ: ['zoj'],
  URAL: ['ural', 'timus'],
  CodeChef: ['cc', 'codechef'],
  Kattis: ['kattis'],
  DMOJ: ['dmoj'],
  CSES: ['cses'],
  USACO: ['usaco'],
  EOlymp: ['eolymp'],
  QOJ: ['qoj'],
  Yosupo: ['yosupo', '库普'],
};

function normalizeOjText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, '');
}

/**
 * 按用户输入匹配远端 OJ：精确名 > 别名 > 前缀 > 子串，存活站点优先。
 * 返回按可信度降序的候选（最多 6 个）。
 */
export function matchRemoteOjs(config: IVjudgeConfig, query: string): IVjudgeRemoteOj[] {
  const needle = normalizeOjText(query);
  if (needle.length === 0) {
    return [];
  }
  const scored: { readonly oj: IVjudgeRemoteOj; readonly score: number }[] = [];
  for (const oj of config.remoteOjs) {
    const name = normalizeOjText(oj.name);
    const aliases = (OJ_ALIASES[oj.name] ?? []).map(normalizeOjText);
    let score = 0;
    if (name === needle || aliases.includes(needle)) {
      score = 100;
    } else if (name.startsWith(needle) || aliases.some((alias) => alias.startsWith(needle))) {
      score = 60;
    } else if (name.includes(needle) || needle.includes(name)) {
      score = 30;
    } else if (aliases.some((alias) => alias.includes(needle) || needle.includes(alias))) {
      score = 20;
    }
    if (score === 0) {
      continue;
    }
    scored.push({ oj, score: score + (oj.isAlive ? 5 : 0) });
  }
  return scored
    .sort((left, right) => right.score - left.score || left.oj.name.length - right.oj.name.length)
    .slice(0, 6)
    .map((entry) => entry.oj);
}

/**
 * 把站点机器码映射为应用判定。
 * 未知码返回 `UNKNOWN`，绝不乐观地当作 `AC`。
 */
export function toVjudgeVerdict(statusCanonical: string): VjudgeVerdict {
  switch (statusCanonical.toUpperCase()) {
    case 'AC':
      return 'AC';
    case 'WA':
      return 'WA';
    case 'TLE':
      return 'TLE';
    case 'MLE':
      return 'MLE';
    case 'RE':
    case 'SE':
    case 'IE':
    case 'RT':
      return 'RE';
    case 'CE':
    case 'QA':
      return 'CE';
    case 'PE':
      return 'WA';
    case 'PENDING':
    case 'RJ':
    case 'SUBMITTED':
    case '':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

const STATEMENT_TYPE_RANK: Readonly<Record<string, number>> = {
  main: 0,
  translator: 1,
  user: 2,
};

/**
 * 从题面版本表中挑选指定语言的最佳版本：
 * 官方主版本优先，其次 LLM 译本、用户改写，同类型取最新。
 */
export function pickStatementVersion(
  versions: readonly IStatementVersion[],
  lang: string,
): IStatementVersion | undefined {
  const candidates = versions.filter((version) => version.lang === lang);
  const pool = candidates.length > 0 ? candidates : versions;
  return [...pool].sort((left, right) => {
    if (left.mainOfficial !== right.mainOfficial) {
      return left.mainOfficial ? -1 : 1;
    }
    if (left.official !== right.official) {
      return left.official ? -1 : 1;
    }
    const typeGap = (STATEMENT_TYPE_RANK[left.type] ?? 9) - (STATEMENT_TYPE_RANK[right.type] ?? 9);
    if (typeGap !== 0) {
      return typeGap;
    }
    return right.version - left.version;
  })[0];
}

function firstNumber(text: string): number | undefined {
  const match = /-?\d+(?:\.\d+)?/.exec(text.replace(/,/g, ''));
  if (match === null) {
    return undefined;
  }
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

/** 解析 `"1000 ms"` / `"2 s"` / `"1 second"` 之类的时限文本为毫秒；无法解析返回 undefined。 */
export function parseTimeLimitMs(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const value = firstNumber(text);
  if (value === undefined) {
    return undefined;
  }
  const lower = text.toLowerCase();
  if (/ms|毫秒/.test(lower)) {
    return Math.round(value);
  }
  if (/\bsec(?:onds?)?\b|\bs\b|秒/.test(lower)) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

/** 解析 `"10000 kB"` / `"256 MB"` 之类的文本为 KB；无法解析返回 undefined。 */
export function parseMemoryLimitKb(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const value = firstNumber(text);
  if (value === undefined) {
    return undefined;
  }
  const lower = text.toLowerCase();
  if (/\bmb\b|兆|megabyte/.test(lower)) {
    return Math.round(value * 1024);
  }
  return Math.round(value);
}
