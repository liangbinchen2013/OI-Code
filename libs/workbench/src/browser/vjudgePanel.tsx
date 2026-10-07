import { onUnexpectedError } from '@oi/base';
import { colorizeCode, type ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRightToBracket,
  faCloudArrowUp,
  faPersonCircleCheck,
  faRightToBracket,
  faRotate,
  faSpinner,
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
  problemKey,
  toVjudgeVerdict,
  VJUDGE_BASE_URL,
} from '@oi/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IJudgeSource } from './judgeTool';
import { renderMarkdown } from './markdown';
import { WORKBENCH_STRINGS } from './strings';

/** 登录态轮询间隔：登录页在 webview 中完成后尽快感知。 */
const ACCOUNT_POLL_INTERVAL_MS = 2_000;

const VJUDGE_LOGIN_URL = `${VJUDGE_BASE_URL}/?login=1&continue=%2F`;

export interface IVjudgePanelProps {
  /** 当前编辑器中可提交的源（无则不可提交）。 */
  readonly resolveSource: () => IJudgeSource | undefined;
  readonly appTheme: ThemeKind;
  readonly hidden?: boolean;
  /** 提交前的本地预检；返回 false 表示用户放弃提交。 */
  readonly precheck?: (source: IJudgeSource, problem: IVjudgeProblem) => Promise<boolean>;
  readonly vjudgeService: IVjudgeServiceClient;
}

interface IWebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
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
export function VjudgePanel({
  resolveSource,
  appTheme,
  hidden,
  precheck,
  vjudgeService,
}: IVjudgePanelProps) {
  const [config, setConfig] = useState<IVjudgeConfig | undefined>(undefined);
  const [account, setAccount] = useState<IVjudgeAccount | undefined>(undefined);
  const [solved, setSolved] = useState<readonly string[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [ojInput, setOjInput] = useState('');
  const [probInput, setProbInput] = useState('');
  const [problem, setProblem] = useState<IVjudgeProblem | undefined>(undefined);
  const [language, setLanguage] = useState('');
  const [submissions, setSubmissions] = useState<readonly IVjudgeSubmission[]>([]);
  const [busy, setBusy] = useState<'fetch' | 'submit' | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const markdownRef = useRef<HTMLElement | null>(null);
  const loginStageRef = useRef<HTMLDivElement | null>(null);

  const refreshAccount = useCallback(async (): Promise<IVjudgeAccount | undefined> => {
    try {
      const next = await vjudgeService.getAccount();
      setAccount(next);
      return next;
    } catch (error) {
      onUnexpectedError(error);
      return undefined;
    }
  }, [vjudgeService]);

  useEffect(() => {
    void vjudgeService.getConfig().then(
      (next) => setConfig(next),
      (error: unknown) => {
        onUnexpectedError(error);
        setMessage(error instanceof Error ? error.message : String(error));
      },
    );
    void refreshAccount();
  }, [refreshAccount, vjudgeService]);

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

  // 未登录且打开了登录窗口时轮询登录结果
  useEffect(() => {
    if (!loginOpen || account?.loggedIn === true) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshAccount();
    }, ACCOUNT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [account?.loggedIn, loginOpen, refreshAccount]);

  // 登录 webview：与内置浏览器同分区，登录成功后 Cookie 即可被主进程复用
  useEffect(() => {
    if (!loginOpen) {
      return undefined;
    }
    const stage = loginStageRef.current;
    if (stage === null) {
      return undefined;
    }
    const webview = document.createElement('webview') as IWebviewElement;
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
  }, [problem?.markdown, appTheme]);

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
      const options = oj.languages;
      setLanguage(options.some((item) => item.id === language) ? language : (options[0]?.id ?? ''));
      if (account?.loggedIn !== true) {
        await refreshAccount();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }, [account?.loggedIn, language, probInput, refreshAccount, resolveOj, vjudgeService]);

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
    setBusy('submit');
    setMessage(undefined);
    try {
      if (precheck !== undefined && !(await precheck(source, target))) {
        return;
      }
      const runId = await vjudgeService.submit({
        language,
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }, [language, precheck, problem, resolveSource, vjudgeService]);

  const languageOptions = resolveOj()?.languages ?? [];
  const loggedIn = account?.loggedIn === true;

  return (
    <section className="oi-vjudge" hidden={hidden} aria-label={WORKBENCH_STRINGS.vjudgeTitle}>
      <header className="oi-vjudge-topbar">
        <span className="oi-vjudge-account">
          <FontAwesomeIcon
            icon={
              account === undefined ? faSpinner : loggedIn ? faPersonCircleCheck : faRightToBracket
            }
            spin={account === undefined}
            aria-hidden="true"
          />
          <span>
            {account === undefined
              ? WORKBENCH_STRINGS.vjudgeAccountChecking
              : loggedIn && account.username !== undefined
                ? WORKBENCH_STRINGS.vjudgeLoggedInAs.replace('{user}', account.username)
                : WORKBENCH_STRINGS.vjudgeNotLoggedIn}
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
          type="button"
          className="oi-btn oi-btn-primary oi-vjudge-submit"
          onClick={() => void submit()}
          disabled={busy !== undefined || problem === undefined}
        >
          <FontAwesomeIcon
            icon={busy === 'submit' ? faSpinner : faCloudArrowUp}
            spin={busy === 'submit'}
            aria-hidden="true"
          />
          <span>
            {busy === 'submit'
              ? WORKBENCH_STRINGS.vjudgeSubmitting
              : WORKBENCH_STRINGS.vjudgeSubmit}
          </span>
        </button>
      </form>

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
              <h1 className="oi-vjudge-problem-title">
                {problemKey(problem.oj, problem.probNum)} · {problem.title}
              </h1>
              <p className="oi-vjudge-problem-meta">
                {problem.timeLimitMs === undefined
                  ? ''
                  : `${WORKBENCH_STRINGS.vjudgeTimeLabel} ${formatNumber(problem.timeLimitMs, 'ms')}`}
                {problem.memoryLimitKb === undefined
                  ? ''
                  : ` · ${WORKBENCH_STRINGS.vjudgeMemoryLabel} ${formatNumber(problem.memoryLimitKb, 'KB')}`}
              </p>
              {problem.markdown.trim().length === 0 ? (
                <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeStatementEmpty}</p>
              ) : (
                // 内容已由 htmlToMarkdown + renderMarkdown 处理，仅生成受控标签
                <div
                  className="oi-preview-markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(problem.markdown) }}
                />
              )}
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
