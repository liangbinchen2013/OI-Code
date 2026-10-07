import { session } from 'electron';
import { DisposableStore, toDisposable, toError, type IDisposable } from '@oi/base';
import {
  htmlToMarkdown,
  IConfigService,
  ILogService,
  parseMemoryLimitKb,
  parseTimeLimitMs,
  pickStatementVersion,
  problemKey,
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

/** 站点在 Cloudflare 之后，过窄的 UA 容易被拦。 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20_000;
/** 判题结果爬取节奏：起始间隔、最大间隔与总预算。 */
const POLL_MIN_MS = 1_000;
const POLL_MAX_MS = 5_000;
const POLL_BUDGET_MS = 10 * 60_000;

/** 登录失效时给用户的统一提示。 */
export const VJUDGE_LOGIN_REQUIRED_MESSAGE = '请先在内置浏览器中登录 VJudge';

interface IFetchResult {
  readonly status: number;
  readonly url: string;
  readonly text: string;
}

interface IRequestInit {
  readonly body?: string;
  readonly method?: string;
}

interface IWatcher {
  cancelled: boolean;
  delay: number;
  deadline: number;
  timer: NodeJS.Timeout | undefined;
}

/**
 * VJudge 主进程服务：所有网络访问集中在此，渲染进程只经 RPC 代理调用。
 * 登录态取自内置浏览器分区（`persist:oi-code-browser`）的 Cookie，应用不保存任何密码。
 */
export class VjudgeService implements IVjudgeService, IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _watchers = new Map<number, IWatcher>();
  private _config: IVjudgeConfig | undefined;
  private _username: string | undefined;

  constructor(
    @ILogService private readonly _logService: ILogService,
    @IConfigService private readonly _configService: IConfigService,
  ) {
    this._disposables.add(toDisposable(() => this._stopAllWatchers()));
    void this._restoreUsername();
  }

  /** 判题结果更新回调，由主进程接到渲染进程通知。 */
  public onDidUpdateSubmission: ((submission: IVjudgeSubmission) => void) | undefined;

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
    const response = await this._fetch('/problem/suggestions?q=a');
    if (response.status === 401 || response.url.includes('login=1')) {
      return { loggedIn: false };
    }
    const username = this._username ?? (await this._cachedUsername());
    if (username === undefined) {
      return { loggedIn: true };
    }
    const solved = await this.getSolvedProblems(username).catch(() => undefined);
    return {
      acceptedCount: solved?.accepted.length,
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
    if (page.url.includes('login=1') || page.status !== 200) {
      throw new Error(VJUDGE_LOGIN_REQUIRED_MESSAGE);
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
      markdown: htmlToMarkdown(description.text),
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
    if (request.bindingId !== undefined) {
      params.set('bindingId', String(request.bindingId));
    }
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
      this.onDidUpdateSubmission?.(submission);
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
    return [
      `提交失败：${key}`,
      i18nKey.length > 0 ? i18nKey : '',
      errorCode.length > 0 ? errorCode : '',
    ]
      .filter((part) => part.length > 0)
      .join('（');
  }

  private async _cookieHeader(): Promise<string> {
    try {
      const cookies = await session
        .fromPartition(OI_CODE_BROWSER_PARTITION)
        .cookies.get({ url: VJUDGE_BASE_URL });
      return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    } catch (error) {
      this._logService.warn(`读取内置浏览器 Cookie 失败：${toError(error).message}`);
      return '';
    }
  }

  private async _fetch(path: string, init?: IRequestInit): Promise<IFetchResult> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (init?.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['Referer'] = `${VJUDGE_BASE_URL}/`;
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

  private async _getJson(path: string): Promise<unknown> {
    const response = await this._fetch(path);
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
