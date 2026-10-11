import { session } from 'electron';
import {
  DisposableStore,
  Emitter,
  toDisposable,
  toError,
  type Event,
  type IDisposable,
} from '@oi/base';
import {
  IConfigService,
  ILogService,
  parseMemoryLimitKb,
  parseTimeLimitMs,
  pickStatementVersion,
  problemKey,
  statementTextToMarkdown,
  VJUDGE_BASE_URL,
  OI_CODE_BROWSER_PARTITION,
  type IVjudgeAccount,
  type IVjudgeConfig,
  type IVjudgeProblem,
  type IVjudgeService,
  type IVjudgeSolvedProblems,
  type IVjudgeSubmission,
  type IVjudgeSubmitRequest,
} from '@oi/platform';
import { CONFIG_KEYS } from './configKeys';
import {
  isRecord,
  parseMySubmissions,
  parseProblemPageData,
  parseRemoteOjs,
  parseStatementVersions,
  parseSubmission,
  parseSolvedRecords,
  readBoolean,
  readNumber,
  readProperty,
  readString,
} from './vjudgeParse';

/**
 * 兜底 UA：站点在 Cloudflare 之后，过窄的 UA 容易被拦。
 * 正常情况下改用内置浏览器分区的 UA，见 `_userAgent()`。
 */
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20_000;
/** 判题结果爬取节奏：起始间隔、最大间隔与总预算。 */
const POLL_MIN_MS = 1_000;
const POLL_MAX_MS = 5_000;
const POLL_BUDGET_MS = 10 * 60_000;

/** 登录失效时给用户的统一提示。 */
export const VJUDGE_LOGIN_REQUIRED_MESSAGE = '请先在内置浏览器中登录 VJudge';

/** 实测见过的 VJudge 提交错误 i18n 键 → 人话；其余键原样带出便于反馈。 */
const SUBMIT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'submit.error.submit_method_not_allowed':
    'VJudge 不允许用服务账号代提交该题，请先在 VJudge 绑定该远端 OJ 的账号',
};

interface IFetchResult {
  readonly status: number;
  readonly url: string;
  readonly text: string;
}

interface IRequestInit {
  readonly ajax?: boolean;
  readonly body?: string;
  readonly method?: string;
}

interface IWatcher {
  cancelled: boolean;
  delay: number;
  deadline: number;
  timer: NodeJS.Timeout | undefined;
}

/** 只用到 Cookie 的名字与值，避免依赖 Electron 全局命名空间类型。 */
interface IPartitionCookie {
  readonly name: string;
  readonly value: string;
}

/**
 * VJudge 主进程服务：所有网络访问集中在此，渲染进程只经 RPC 代理调用。
 * 登录态取自内置浏览器分区（`persist:oi-code-browser`）的 Cookie，应用不保存任何密码。
 */
export class VjudgeService implements IVjudgeService, IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidSubmissionUpdate = new Emitter<IVjudgeSubmission>();
  private readonly _watchers = new Map<number, IWatcher>();
  private _config: IVjudgeConfig | undefined;
  private _username: string | undefined;
  private _cachedUserAgent = '';

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IConfigService private readonly _configService: IConfigService,
  ) {
    this._disposables.add(this._onDidSubmissionUpdate);
    this._disposables.add(toDisposable(() => this._stopAllWatchers()));
    void this._restoreUsername().catch((error: unknown) => {
      this._logService.warn(`读取 VJudge 用户名缓存失败：${toError(error).message}`);
    });
  }

  get onDidSubmissionUpdate(): Event<IVjudgeSubmission> {
    return this._onDidSubmissionUpdate.event;
  }

  async getConfig(): Promise<IVjudgeConfig> {
    if (this._config !== undefined) {
      return this._config;
    }
    const raw = await this._getJson('/util/cfg');
    const config: IVjudgeConfig = {
      remoteOjs: parseRemoteOjs(isRecord(raw) ? raw['remoteOJs'] : undefined),
      statementLanguages: this._readStringRecord(
        isRecord(raw) ? raw['statementLanguages'] : undefined,
      ),
      version: isRecord(raw) ? (readNumber(raw, 'version') ?? 0) : 0,
    };
    this._config = config;
    return config;
  }

  async getAccount(): Promise<IVjudgeAccount> {
    // suggestions 是轻量且需登录的端点：401 即未登录
    let response = await this._fetch('/problem/suggestions?q=a', { ajax: true });
    if (VjudgeService._isBlocked(response)) {
      throw new Error(`VJudge 登录状态查询被拦截（HTTP ${response.status}）`);
    }
    if (VjudgeService._isLoggedOut(response)) {
      // 会话 Cookie 轮换会让第一次探测撞上旧值，重读 Cookie 再确认一次
      response = await this._fetch('/problem/suggestions?q=a', { ajax: true });
      if (VjudgeService._isBlocked(response)) {
        throw new Error(`VJudge 登录状态查询被拦截（HTTP ${response.status}）`);
      }
      if (VjudgeService._isLoggedOut(response)) {
        const cookies = await this._partitionCookies();
        this._logService.info(
          `VJudge 登录探测判定未登录（HTTP ${response.status}，分区 Cookie ${cookies.length} 条）`,
        );
        return { loggedIn: false };
      }
    }
    // 网关故障等不能当作"已登录"，否则会把拦截误报成账号状态
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`VJudge 登录状态查询失败（HTTP ${response.status}）`);
    }
    const username = this._username ?? (await this._cachedUsername());
    if (username === undefined) {
      return { loggedIn: true };
    }
    let acceptedCount: number | undefined;
    try {
      acceptedCount = (await this.getSolvedProblems(username)).accepted.length;
    } catch (error) {
      this._logService.warn(`读取 VJudge 通过记录失败：${toError(error).message}`);
    }
    return {
      ...(acceptedCount === undefined ? {} : { acceptedCount }),
      loggedIn: true,
      username,
    };
  }

  async fetchProblem(oj: string, probNum: string, lang = 'zh'): Promise<IVjudgeProblem> {
    const key = problemKey(oj, probNum);
    const info = await this._getJson(`/problem/info/${encodeURIComponent(key)}`);
    const title = isRecord(info) ? readString(info, 'title') : '';
    if (isRecord(info) && readBoolean(info, 'crawling')) {
      this._logService.info(`VJudge 正在抓取题面：${key}`);
    }

    const page = await this._fetch(`/problem/${encodeURIComponent(key)}`);
    if (page.url.includes('login=1')) {
      throw new Error(VJUDGE_LOGIN_REQUIRED_MESSAGE);
    }
    if (page.status !== 200) {
      throw new Error(`题目页获取失败（HTTP ${page.status}）：${key}`);
    }
    const data = parseProblemPageData(page.text);
    if (data === undefined) {
      throw new Error(`未能解析题目页数据：${key}`);
    }
    const username = readString(data, 'username');
    if (username.length > 0 && username !== this._username) {
      await this._rememberUsername(username);
    }

    const statements = parseStatementVersions(data['descBriefs']);
    const chosen = pickStatementVersion(statements, lang) ?? pickStatementVersion(statements, 'en');
    if (chosen === undefined) {
      throw new Error(`该题没有可用题面：${key}`);
    }
    const description = await this._fetch(`/problem/description/${encodeURIComponent(chosen.key)}`);
    if (description.status !== 200) {
      throw new Error(`题面获取失败（${description.status}）：${key}`);
    }
    const timeLimitMs = parseTimeLimitMs(readProperty(data, 'time_limit'));
    const memoryLimitKb = parseMemoryLimitKb(readProperty(data, 'mem_limit'));
    return {
      markdown: statementTextToMarkdown(description.text),
      memoryLimitKb,
      mySubmissions: parseMySubmissions(data['mySols']),
      oj: readString(data, 'oj').length > 0 ? readString(data, 'oj') : oj,
      probNum: readString(data, 'prob').length > 0 ? readString(data, 'prob') : probNum,
      problemId: readNumber(data, 'problemId') ?? 0,
      statementKey: chosen.key,
      statements,
      submitMethods: Array.isArray(data['submitMethods'])
        ? data['submitMethods'].map((item): boolean => item === true)
        : [],
      ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
      title,
    };
  }

  async submit(request: IVjudgeSubmitRequest): Promise<number> {
    const key = problemKey(request.oj, request.probNum);
    const params = new URLSearchParams({
      language: request.language,
      method: String(request.method ?? 0),
      open: String(request.open ?? 1),
      source: request.source,
    });
    const response = await this._fetch(`/problem/submit/${encodeURIComponent(key)}`, {
      body: params.toString(),
      method: 'POST',
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      parsed = undefined;
    }
    if (!isRecord(parsed)) {
      throw new Error(`提交失败（HTTP ${response.status}）：${key}`);
    }
    const runId = readNumber(parsed, 'runId');
    if (runId === undefined) {
      const error = isRecord(parsed['error']) ? parsed['error'] : undefined;
      const i18nKey = error === undefined ? '' : readString(error, 'i18nKey');
      const errorCode = readString(parsed, 'errorCode');
      this._logService.warn(
        `VJudge 提交失败 ${key}：method=${String(request.method ?? 0)} http=${response.status} i18n=${i18nKey} code=${errorCode}`,
      );
      throw new Error(this._describeSubmitFailure(key, i18nKey, errorCode));
    }
    await this.watch(runId);
    return runId;
  }

  async getSubmission(runId: number, showCode = false): Promise<IVjudgeSubmission> {
    const response = await this._fetch(`/solution/data/${runId}`, {
      body: new URLSearchParams({ showCode: String(showCode) }).toString(),
      method: 'POST',
    });
    if (response.status !== 200) {
      throw new Error(`结果查询失败（HTTP ${response.status}）：${runId}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error(`结果查询返回了非 JSON 内容：${runId}`);
    }
    return parseSubmission(runId, parsed);
  }

  async watch(runId: number): Promise<void> {
    if (this._watchers.has(runId)) {
      return;
    }
    const watcher: IWatcher = {
      cancelled: false,
      delay: POLL_MIN_MS,
      deadline: Date.now() + POLL_BUDGET_MS,
      timer: undefined,
    };
    this._watchers.set(runId, watcher);
    this._schedule(runId, watcher);
  }

  async unwatch(runId: number): Promise<void> {
    this._stopWatcher(runId);
  }

  async getSolvedProblems(username: string): Promise<IVjudgeSolvedProblems> {
    const raw = await this._getJson(`/user/solveDetail/${encodeURIComponent(username)}`);
    return {
      accepted: parseSolvedRecords(isRecord(raw) ? raw['acRecords'] : undefined),
      failed: parseSolvedRecords(isRecord(raw) ? raw['failRecords'] : undefined),
    };
  }

  dispose(): void {
    this._disposables.dispose();
  }

  private _schedule(runId: number, watcher: IWatcher): void {
    watcher.timer = setTimeout(() => {
      void this._pollOnce(runId, watcher);
    }, watcher.delay);
  }

  private async _pollOnce(runId: number, watcher: IWatcher): Promise<void> {
    if (watcher.cancelled) {
      return;
    }
    try {
      const submission = await this.getSubmission(runId);
      // 请求期间可能已被 unwatch / dispose：不再推送陈旧更新，也不再续排
      if (this._watchers.get(runId) !== watcher) {
        return;
      }
      this._onDidSubmissionUpdate.fire(submission);
      if (!submission.processing || Date.now() > watcher.deadline) {
        this._stopWatcher(runId);
        return;
      }
    } catch (error) {
      this._logService.warn(`VJudge 结果爬取失败（${runId}）：${toError(error).message}`);
      if (Date.now() > watcher.deadline) {
        this._stopWatcher(runId);
        return;
      }
    }
    watcher.delay = Math.min(Math.round(watcher.delay * 1.6), POLL_MAX_MS);
    this._schedule(runId, watcher);
  }

  private _stopWatcher(runId: number): void {
    const watcher = this._watchers.get(runId);
    if (watcher === undefined) {
      return;
    }
    watcher.cancelled = true;
    if (watcher.timer !== undefined) {
      clearTimeout(watcher.timer);
    }
    this._watchers.delete(runId);
  }

  private _stopAllWatchers(): void {
    for (const runId of [...this._watchers.keys()]) {
      this._stopWatcher(runId);
    }
  }

  private _describeSubmitFailure(key: string, i18nKey: string, errorCode: string): string {
    if (errorCode.startsWith('bind_account') || i18nKey.includes('bind_account')) {
      return `提交 ${key} 需要先在 VJudge 绑定该远端 OJ 的账号`;
    }
    const known = SUBMIT_ERROR_MESSAGES[i18nKey];
    if (known !== undefined) {
      return `提交失败：${key}——${known}`;
    }
    const detail = i18nKey.length > 0 ? i18nKey : errorCode;
    return detail.length === 0 ? `提交失败：${key}` : `提交失败：${key}（VJudge 提示：${detail}）`;
  }

  /**
   * 与内置浏览器（登录发生的地方）用同一个 UA：
   * Cloudflare 的 cf_clearance 与站点会话都跟 UA 绑定，UA 不一致会被判成另一个客户端，
   * 表现为"网页里明明已登录，接口却时不时返回未登录"。
   */
  private _userAgent(): string {
    if (this._cachedUserAgent.length === 0) {
      try {
        this._cachedUserAgent = session.fromPartition(OI_CODE_BROWSER_PARTITION).getUserAgent();
      } catch (error) {
        this._logService.warn(`读取内置浏览器 UA 失败，改用兜底 UA：${toError(error).message}`);
        this._cachedUserAgent = FALLBACK_USER_AGENT;
      }
    }
    return this._cachedUserAgent;
  }

  private async _partitionCookies(): Promise<readonly IPartitionCookie[]> {
    try {
      return await session
        .fromPartition(OI_CODE_BROWSER_PARTITION)
        .cookies.get({ url: VJUDGE_BASE_URL });
    } catch (error) {
      this._logService.warn(`读取内置浏览器 Cookie 失败：${toError(error).message}`);
      return [];
    }
  }

  private async _cookieHeader(): Promise<string> {
    return (await this._partitionCookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  private async _fetch(path: string, init?: IRequestInit): Promise<IFetchResult> {
    const ajax = init?.ajax === true || init?.method === 'POST';
    const headers: Record<string, string> = {
      'User-Agent': this._userAgent(),
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: `${VJUDGE_BASE_URL}/`,
    };
    if (init?.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    if (ajax) {
      // 与站点自己的 jQuery 请求保持一致，避免被当成匿名爬取
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
    }
    const cookie = await this._cookieHeader();
    if (cookie.length > 0) {
      headers['Cookie'] = cookie;
    }
    const response = await fetch(`${VJUDGE_BASE_URL}${path}`, {
      body: init?.body,
      headers,
      method: init?.method ?? 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await response.text();
    return { status: response.status, text, url: response.url };
  }

  /** 被 CDN/防火墙拦下时不能把结果当成"未登录"。 */
  private static _isBlocked(response: IFetchResult): boolean {
    return (
      response.status === 403 ||
      response.status === 429 ||
      response.status >= 500 ||
      /just a moment|cf-chl|attention required/i.test(response.text.slice(0, 4000))
    );
  }

  private static _isLoggedOut(response: IFetchResult): boolean {
    return response.status === 401 || response.url.includes('login=1');
  }

  private async _getJson(path: string): Promise<unknown> {
    const response = await this._fetch(path, { ajax: true });
    if (response.status !== 200) {
      throw new Error(`VJudge 请求失败（HTTP ${response.status}）：${path}`);
    }
    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      throw new Error(`VJudge 返回了非 JSON 内容：${path}`);
    }
  }

  private _readStringRecord(value: unknown): Record<string, string> {
    if (!isRecord(value)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        result[key] = item;
      }
    }
    return result;
  }

  private async _restoreUsername(): Promise<void> {
    const cached = await this._configService.get(CONFIG_KEYS.vjudgeUsername);
    if (typeof cached === 'string' && cached.length > 0) {
      this._username = cached;
    }
  }

  private async _cachedUsername(): Promise<string | undefined> {
    if (this._username !== undefined) {
      return this._username;
    }
    const cached = await this._configService.get(CONFIG_KEYS.vjudgeUsername);
    return typeof cached === 'string' && cached.length > 0 ? cached : undefined;
  }

  private async _rememberUsername(username: string): Promise<void> {
    this._username = username;
    await this._configService.set(CONFIG_KEYS.vjudgeUsername, username);
  }
}
