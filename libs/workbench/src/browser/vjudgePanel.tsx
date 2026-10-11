import { onUnexpectedError } from '@oi/base';
import { colorizeCode, type ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRightToBracket,
  faArrowUpRightFromSquare,
  faCloudArrowUp,
  faExpand,
  faMinimize,
  faPersonCircleCheck,
  faRightToBracket,
  faRotate,
  faSpinner,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type {
  IVjudgeAccount,
  IVjudgeConfig,
  IVjudgeProblem,
  IVjudgeRemoteOj,
  IVjudgeServiceClient,
  IVjudgeSubmission,
} from '@oi/platform';
import {
  matchRemoteOjs,
  OI_CODE_BROWSER_PARTITION,
  pickDefaultLanguage,
  pickSubmitMethod,
  problemKey,
  remoteAccountsUrl,
  requiresRemoteBinding,
  toVjudgeVerdict,
  VJUDGE_BASE_URL,
} from '@oi/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IJudgeSource } from './judgeTool';
import { renderMarkdown } from './markdown';
import { WORKBENCH_STRINGS } from './strings';

/** 登录态轮询间隔：登录页在 webview 中完成后尽快感知。 */
const ACCOUNT_POLL_INTERVAL_MS = 2_000;
/** 面板激活但未登录时的低频复查间隔，避免必须重启应用才识别登录。 */
const ACCOUNT_IDLE_POLL_INTERVAL_MS = 15_000;

const VJUDGE_LOGIN_URL = `${VJUDGE_BASE_URL}/?login=1&continue=%2F`;

export interface IVjudgePanelProps {
  /** 当前编辑器中可提交的源（无则不可提交）。 */
  readonly resolveSource: () => IJudgeSource | undefined;
  readonly appTheme: ThemeKind;
  readonly hidden?: boolean;
  readonly vjudgeService: IVjudgeServiceClient;
}

function verdictClass(submission: IVjudgeSubmission): string {
  const verdict = toVjudgeVerdict(submission.statusCanonical);
  if (submission.processing || verdict === 'PENDING') {
    return 'oi-vjudge-pending';
  }
  return verdict === 'AC' ? 'oi-vjudge-ac' : 'oi-vjudge-fail';
}

function formatNumber(value: number | undefined, unit: string): string {
  return value === undefined ? '—' : `${value} ${unit}`;
}

/** 匹配到的 OJ 候选；输入已精确等于某个 OJ 名时不再展示。 */
function candidatesFor(
  config: IVjudgeConfig | undefined,
  query: string,
): readonly IVjudgeRemoteOj[] {
  const trimmed = query.trim();
  if (config === undefined || trimmed.length === 0) {
    return [];
  }
  if (config.remoteOjs.some((oj) => oj.name === trimmed)) {
    return [];
  }
  return matchRemoteOjs(config, trimmed).slice(0, 6);
}

/**
 * VJudge 视图：登录、抓题面（Markdown 渲染）、远程提交与判题结果回爬。
 * 网络与 Cookie 全在主进程，本组件只负责编排与展示。
 */
export function VjudgePanel({ resolveSource, appTheme, hidden, vjudgeService }: IVjudgePanelProps) {
  const [config, setConfig] = useState<IVjudgeConfig | undefined>(undefined);
  const [account, setAccount] = useState<IVjudgeAccount | undefined>(undefined);
  const [accountUnknown, setAccountUnknown] = useState(false);
  const [solved, setSolved] = useState<readonly string[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [ojInput, setOjInput] = useState('');
  const [probInput, setProbInput] = useState('');
  const [problem, setProblem] = useState<IVjudgeProblem | undefined>(undefined);
  const [language, setLanguage] = useState('');
  const [submissions, setSubmissions] = useState<readonly IVjudgeSubmission[]>([]);
  const [busy, setBusy] = useState<'fetch' | 'submit' | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [activated, setActivated] = useState(hidden !== true);
  const [expanded, setExpanded] = useState(false);
  const currentKeyRef = useRef('');
  const markdownRef = useRef<HTMLElement | null>(null);
  const loginStageRef = useRef<HTMLDivElement | null>(null);

  const currentKey = problem === undefined ? '' : problemKey(problem.oj, problem.probNum);
  currentKeyRef.current = currentKey;

  const refreshAccount = useCallback(async (): Promise<IVjudgeAccount | undefined> => {
    try {
      const next = await vjudgeService.getAccount();
      setAccount(next);
      setAccountUnknown(false);
      return next;
    } catch (error) {
      onUnexpectedError(error);
      // 网络不通时也必须给出结论，否则顶部会永远停在"正在检查登录态"
      setAccountUnknown(true);
      return undefined;
    }
  }, [vjudgeService]);

  // 面板常驻挂载：首次真正可见时才发请求，避免从不用 VJudge 也产生外网访问
  useEffect(() => {
    if (hidden !== false || activated) {
      return;
    }
    setActivated(true);
  }, [activated, hidden]);

  useEffect(() => {
    if (!activated) {
      return;
    }
    void vjudgeService.getConfig().then(
      (next) => setConfig(next),
      (error: unknown) => {
        onUnexpectedError(error);
        setMessage(error instanceof Error ? error.message : String(error));
      },
    );
    void refreshAccount();
  }, [activated, refreshAccount, vjudgeService]);

  // 登录后拉取通过记录，用于顶部展示与点击复用
  useEffect(() => {
    const username = account?.username;
    if (account?.loggedIn !== true || username === undefined) {
      setSolved([]);
      return undefined;
    }
    void vjudgeService.getSolvedProblems(username).then(
      (records) => setSolved(records.accepted),
      (error: unknown) => onUnexpectedError(error),
    );
    return undefined;
  }, [account, vjudgeService]);

  // 登录态刷新：面板激活后持续检查（开着登录窗口时更快），
  // 否则在别处（内置浏览器）登录后要重启应用才能识别
  useEffect(() => {
    if (!activated) {
      return undefined;
    }
    const interval =
      loginOpen && account?.loggedIn !== true
        ? ACCOUNT_POLL_INTERVAL_MS
        : ACCOUNT_IDLE_POLL_INTERVAL_MS;
    const timer = window.setInterval(() => {
      void refreshAccount();
    }, interval);
    return () => window.clearInterval(timer);
  }, [account?.loggedIn, activated, loginOpen, refreshAccount]);

  // 登录 webview：与内置浏览器同分区，登录成功后 Cookie 即可被主进程复用
  useEffect(() => {
    if (!loginOpen) {
      return undefined;
    }
    const stage = loginStageRef.current;
    if (stage === null) {
      return undefined;
    }
    const webview = document.createElement('webview');
    webview.className = 'oi-vjudge-login-view';
    webview.setAttribute('partition', OI_CODE_BROWSER_PARTITION);
    webview.setAttribute('src', VJUDGE_LOGIN_URL);
    stage.appendChild(webview);
    return () => {
      webview.remove();
    };
  }, [loginOpen]);

  // 判题结果回爬更新：按 runId 合并
  useEffect(() => {
    const remove = vjudgeService.onDidSubmissionUpdate((submission) => {
      // 后台轮询可能属于别的题目：只接收当前题目的更新
      if (problemKey(submission.oj, submission.probNum) !== currentKeyRef.current) {
        return;
      }
      setSubmissions((previous) => [
        submission,
        ...previous.filter((item) => item.runId !== submission.runId),
      ]);
    });
    return () => remove.dispose();
  }, [vjudgeService]);

  // 题面代码块二次着色（与 Markdown 预览一致）
  useEffect(() => {
    const root = markdownRef.current;
    const markdown = problem?.markdown;
    if (root === null || markdown === undefined) {
      return undefined;
    }
    let cancelled = false;
    for (const block of root.querySelectorAll<HTMLElement>('pre.oi-md-code[data-language]')) {
      const languageId = block.dataset['language'] ?? 'plaintext';
      const code = block.textContent ?? '';
      void colorizeCode(code, languageId).then(
        (highlighted) => {
          if (!cancelled) {
            block.innerHTML = highlighted;
          }
        },
        (error: unknown) => onUnexpectedError(error),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [problem?.markdown, appTheme, expanded]);

  // 放大阅读：Esc 收回，并把焦点移入题面，避免 Tab 落在被遮住的侧栏部件上
  useEffect(() => {
    if (!expanded) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    markdownRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const resolveOj = useCallback((): IVjudgeRemoteOj | undefined => {
    if (config === undefined) {
      return undefined;
    }
    const exact = config.remoteOjs.find((oj) => oj.name === ojInput.trim());
    return exact ?? matchRemoteOjs(config, ojInput)[0];
  }, [config, ojInput]);

  // 候选由 config 派生：配置晚于输入到达时也能立即出现候选
  const candidates = useMemo(() => candidatesFor(config, ojInput), [config, ojInput]);

  const pickOj = useCallback((oj: IVjudgeRemoteOj): void => {
    setOjInput(oj.name);
  }, []);

  const loadProblem = useCallback(async (): Promise<void> => {
    const oj = resolveOj();
    const probNum = probInput.trim();
    if (oj === undefined || probNum.length === 0) {
      setMessage(oj === undefined ? WORKBENCH_STRINGS.vjudgeOj : WORKBENCH_STRINGS.vjudgeProbNum);
      return;
    }
    setBusy('fetch');
    setMessage(undefined);
    try {
      const next = await vjudgeService.fetchProblem(oj.name, probNum);
      setProblem(next);
      setSubmissions(
        next.mySubmissions.map((brief) => ({
          oj: next.oj,
          processing: false,
          probNum: next.probNum,
          runId: brief.runId,
          status: brief.status,
          statusCanonical: brief.statusCanonical,
        })),
      );
      // 历史提交里仍有未定论的（如刚在别处提交过），继续爬取到终态
      for (const brief of next.mySubmissions) {
        if (brief.statusCanonical.length === 0 || brief.statusCanonical === 'PENDING') {
          void vjudgeService.watch(brief.runId).catch((error: unknown) => onUnexpectedError(error));
        }
      }
      const options = oj.languages;
      // 默认语言按编辑器源语言择优：洛谷等站点列表第一项是 Pascal
      setLanguage(pickDefaultLanguage(options, resolveSource()?.language));
      await refreshAccount();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      // 失败常由登录态变化引起（刚登录/会话过期），顺手刷新账号显示
      await refreshAccount();
    } finally {
      setBusy(undefined);
    }
  }, [probInput, refreshAccount, resolveSource, resolveOj, vjudgeService]);

  const sendToVjudge = useCallback(
    async (source: IJudgeSource, target: IVjudgeProblem): Promise<void> => {
      // 提交方式由题面允许列表决定：洛谷等站点关闭代提交，硬发 0 会被拒
      const method = pickSubmitMethod(target.submitMethods);
      if (method === undefined) {
        throw new Error(
          requiresRemoteBinding(target.submitMethods)
            ? WORKBENCH_STRINGS.vjudgeNeedBinding
            : WORKBENCH_STRINGS.vjudgeSubmitNoMethod,
        );
      }
      const runId = await vjudgeService.submit({
        language,
        method,
        oj: target.oj,
        probNum: target.probNum,
        source: source.content,
      });
      setSubmissions((previous) => [
        {
          oj: target.oj,
          processing: true,
          probNum: target.probNum,
          runId,
          status: '',
          statusCanonical: 'PENDING',
        },
        ...previous,
      ]);
    },
    [language, vjudgeService],
  );

  const submit = useCallback(async (): Promise<void> => {
    const source = resolveSource();
    const target = problem;
    if (source === undefined || target === undefined) {
      setMessage(
        target === undefined
          ? WORKBENCH_STRINGS.vjudgeIdleHint
          : WORKBENCH_STRINGS.vjudgeNeedSource,
      );
      return;
    }
    if (language.length === 0) {
      setMessage(WORKBENCH_STRINGS.vjudgeNeedLanguage);
      return;
    }
    setMessage(undefined);
    setBusy('submit');
    try {
      await sendToVjudge(source, target);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }, [language, problem, resolveSource, sendToVjudge]);

  const languageOptions = resolveOj()?.languages ?? [];
  const loggedIn = account?.loggedIn === true;
  /** 该题只允许用绑定的远端账号提交：本工具不代管绑定，只能把用户送到站点完成。 */
  const needsBinding = problem !== undefined && requiresRemoteBinding(problem.submitMethods);
  const bindingNotice = needsBinding ? (
    <p className="oi-vjudge-message oi-vjudge-binding" role="status">
      <span>{WORKBENCH_STRINGS.vjudgeNeedBinding}</span>
      <a
        className="oi-btn oi-btn-secondary oi-btn-sm oi-vjudge-bind"
        href={remoteAccountsUrl(problem?.oj ?? ojInput)}
        target="_blank"
        rel="noreferrer"
      >
        <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
        <span>{WORKBENCH_STRINGS.vjudgeBindAccounts}</span>
      </a>
    </p>
  ) : null;

  const titleLine =
    problem === undefined ? null : (
      <h1 className="oi-vjudge-problem-title">
        {problemKey(problem.oj, problem.probNum)} · {problem.title}
      </h1>
    );
  const metaLine =
    problem === undefined ? null : (
      <p className="oi-vjudge-problem-meta">
        {problem.timeLimitMs === undefined
          ? ''
          : `${WORKBENCH_STRINGS.vjudgeTimeLabel} ${formatNumber(problem.timeLimitMs, 'ms')}`}
        {problem.memoryLimitKb === undefined
          ? ''
          : ` · ${WORKBENCH_STRINGS.vjudgeMemoryLabel} ${formatNumber(problem.memoryLimitKb, 'KB')}`}
      </p>
    );
  const statementBody =
    problem === undefined ? (
      <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeIdleHint}</p>
    ) : problem.markdown.trim().length === 0 ? (
      <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeStatementEmpty}</p>
    ) : (
      // 内容已由题面转换器 + renderMarkdown 处理，仅生成受控标签
      <div
        className="oi-preview-markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(problem.markdown) }}
      />
    );
  const submitButton = (
    <button
      type="button"
      className="oi-btn oi-btn-primary oi-vjudge-submit"
      onClick={() => void submit()}
      disabled={busy !== undefined || problem === undefined || needsBinding}
      title={needsBinding ? WORKBENCH_STRINGS.vjudgeNeedBinding : undefined}
    >
      <FontAwesomeIcon
        icon={busy === 'submit' ? faSpinner : faCloudArrowUp}
        spin={busy === 'submit'}
        aria-hidden="true"
      />
      <span>
        {busy === 'submit' ? WORKBENCH_STRINGS.vjudgeSubmitting : WORKBENCH_STRINGS.vjudgeSubmit}
      </span>
    </button>
  );

  // 放大阅读：题面占满整个侧边栏面板，只留提交与缩小按钮
  if (expanded && problem !== undefined) {
    return (
      <section
        className="oi-vjudge"
        hidden={hidden}
        aria-label={`${WORKBENCH_STRINGS.vjudgeTitle} · ${problemKey(problem.oj, problem.probNum)}`}
      >
        <header className="oi-vjudge-read-bar">
          <div className="oi-vjudge-read-title">
            {titleLine}
            {metaLine}
          </div>
          {submitButton}
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-btn-secondary oi-vjudge-shrink"
            onClick={() => setExpanded(false)}
            title={WORKBENCH_STRINGS.vjudgeShrink}
            aria-label={WORKBENCH_STRINGS.vjudgeShrink}
          >
            <FontAwesomeIcon icon={faMinimize} aria-hidden="true" />
          </button>
        </header>
        {bindingNotice}
        <article
          ref={markdownRef}
          className="oi-vjudge-statement oi-vjudge-statement-expanded"
          tabIndex={-1}
          aria-label={problem.title}
        >
          {statementBody}
        </article>
        {message !== undefined ? (
          <p className="oi-vjudge-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="oi-vjudge" hidden={hidden} aria-label={WORKBENCH_STRINGS.vjudgeTitle}>
      <header className="oi-vjudge-topbar">
        <span className="oi-vjudge-account">
          <FontAwesomeIcon
            icon={
              account !== undefined
                ? loggedIn
                  ? faPersonCircleCheck
                  : faRightToBracket
                : accountUnknown
                  ? faTriangleExclamation
                  : faSpinner
            }
            spin={account === undefined && !accountUnknown}
            aria-hidden="true"
          />
          <span>
            {account !== undefined
              ? loggedIn && account.username !== undefined
                ? WORKBENCH_STRINGS.vjudgeLoggedInAs.replace('{user}', account.username)
                : WORKBENCH_STRINGS.vjudgeNotLoggedIn
              : accountUnknown
                ? WORKBENCH_STRINGS.vjudgeAccountUnknown
                : WORKBENCH_STRINGS.vjudgeAccountChecking}
          </span>
          {account?.acceptedCount !== undefined ? (
            <span className="oi-vjudge-count">
              {WORKBENCH_STRINGS.vjudgeAcceptedCount.replace(
                '{count}',
                String(account.acceptedCount),
              )}
            </span>
          ) : null}
        </span>
        <span className="oi-vjudge-spacer" />
        {loggedIn ? null : (
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-btn-sm oi-vjudge-login-btn"
            onClick={() => setLoginOpen((open) => !open)}
          >
            <FontAwesomeIcon icon={faRightToBracket} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.vjudgeLogin}</span>
          </button>
        )}
      </header>

      {loggedIn && solved.length > 0 ? (
        <div className="oi-vjudge-solved" aria-label={WORKBENCH_STRINGS.vjudgeSolved}>
          {solved.slice(0, 24).map((key) => (
            <button
              key={key}
              type="button"
              className="oi-vjudge-chip"
              onClick={() => {
                const separator = key.lastIndexOf('-');
                setOjInput(key.slice(0, separator));
                setProbInput(key.slice(separator + 1));
              }}
            >
              {key}
            </button>
          ))}
        </div>
      ) : null}

      {loginOpen && !loggedIn ? (
        <div className="oi-vjudge-login">
          <div className="oi-vjudge-login-hint">
            <span>{WORKBENCH_STRINGS.vjudgeLoginHint}</span>
            <button
              type="button"
              className="oi-btn oi-btn-icon oi-btn-secondary oi-vjudge-login-close"
              onClick={() => setLoginOpen(false)}
              title={WORKBENCH_STRINGS.vjudgeLoginClose}
              aria-label={WORKBENCH_STRINGS.vjudgeLoginClose}
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          </div>
          <div className="oi-vjudge-login-stage" ref={loginStageRef} />
        </div>
      ) : null}

      <form
        className="oi-vjudge-query"
        onSubmit={(event) => {
          event.preventDefault();
          void loadProblem();
        }}
      >
        <label className="oi-vjudge-field">
          <span className="oi-settings-label">{WORKBENCH_STRINGS.vjudgeOj}</span>
          <input
            className="oi-input"
            type="text"
            value={ojInput}
            placeholder={WORKBENCH_STRINGS.vjudgeOjPlaceholder}
            aria-label={WORKBENCH_STRINGS.vjudgeOj}
            onChange={(event) => setOjInput(event.target.value)}
          />
        </label>
        <label className="oi-vjudge-field oi-vjudge-field-prob">
          <span className="oi-settings-label">{WORKBENCH_STRINGS.vjudgeProbNum}</span>
          <input
            className="oi-input"
            type="text"
            value={probInput}
            placeholder={WORKBENCH_STRINGS.vjudgeProbPlaceholder}
            aria-label={WORKBENCH_STRINGS.vjudgeProbNum}
            onChange={(event) => setProbInput(event.target.value)}
          />
        </label>
        <label className="oi-vjudge-field oi-vjudge-field-lang">
          <span className="oi-settings-label">{WORKBENCH_STRINGS.vjudgeLanguage}</span>
          <select
            className="oi-select"
            value={language}
            aria-label={WORKBENCH_STRINGS.vjudgeLanguage}
            disabled={languageOptions.length === 0}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {languageOptions.length === 0 ? (
              <option value="">{WORKBENCH_STRINGS.vjudgeNeedLanguage}</option>
            ) : null}
            {languageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="oi-btn oi-btn-secondary oi-vjudge-fetch"
          disabled={busy !== undefined}
        >
          <FontAwesomeIcon
            icon={busy === 'fetch' ? faSpinner : faRotate}
            spin={busy === 'fetch'}
            aria-hidden="true"
          />
          <span>
            {busy === 'fetch' ? WORKBENCH_STRINGS.vjudgeFetching : WORKBENCH_STRINGS.vjudgeFetch}
          </span>
        </button>
        {submitButton}
      </form>

      {bindingNotice}

      {candidates.length > 0 ? (
        <div
          className="oi-vjudge-candidates"
          role="listbox"
          aria-label={WORKBENCH_STRINGS.vjudgeCandidates}
        >
          {candidates.map((oj) => (
            <button
              key={oj.name}
              type="button"
              role="option"
              aria-selected={oj.name === ojInput}
              className="oi-vjudge-candidate"
              onClick={() => pickOj(oj)}
            >
              <FontAwesomeIcon icon={faArrowRightToBracket} aria-hidden="true" />
              <span>{oj.name}</span>
              {oj.isAlive ? null : (
                <span className="oi-vjudge-offline">{WORKBENCH_STRINGS.vjudgeOjOffline}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {message !== undefined ? (
        <p className="oi-vjudge-message" role="status">
          {message}
        </p>
      ) : null}

      <div className="oi-vjudge-content">
        <article
          ref={markdownRef}
          className="oi-vjudge-statement"
          aria-label={problem?.title ?? WORKBENCH_STRINGS.vjudgeTitle}
        >
          {problem === undefined ? (
            <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeIdleHint}</p>
          ) : (
            <>
              <div className="oi-vjudge-statement-head">
                {titleLine}
                <button
                  type="button"
                  className="oi-btn oi-btn-icon oi-btn-secondary oi-btn-sm oi-vjudge-expand"
                  onClick={() => setExpanded(true)}
                  title={WORKBENCH_STRINGS.vjudgeExpand}
                  aria-label={WORKBENCH_STRINGS.vjudgeExpand}
                >
                  <FontAwesomeIcon icon={faExpand} aria-hidden="true" />
                </button>
              </div>
              {metaLine}
              {statementBody}
            </>
          )}
        </article>

        <aside className="oi-vjudge-results" aria-label={WORKBENCH_STRINGS.vjudgeResults}>
          <h2 className="oi-vjudge-results-title">{WORKBENCH_STRINGS.vjudgeResults}</h2>
          {submissions.length === 0 ? (
            <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeResultsEmpty}</p>
          ) : (
            <ul className="oi-vjudge-runs">
              {submissions.map((submission) => (
                <li key={submission.runId} className="oi-vjudge-run">
                  <span className={`oi-vjudge-badge ${verdictClass(submission)}`}>
                    {submission.statusCanonical.length > 0
                      ? submission.statusCanonical
                      : submission.status}
                  </span>
                  <span className="oi-vjudge-run-meta">
                    #{submission.runId} · {formatNumber(submission.runtimeMs, 'ms')} ·{' '}
                    {formatNumber(submission.memoryKb, 'KB')}
                  </span>
                  {submission.remoteRunId !== undefined ? (
                    <span className="oi-vjudge-run-remote">
                      {WORKBENCH_STRINGS.vjudgeRemoteLabel} {submission.remoteRunId}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
