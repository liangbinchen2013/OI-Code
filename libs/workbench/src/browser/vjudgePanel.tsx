import { onUnexpectedError } from '@oi/base';
import { colorizeCode, type ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRightToBracket,
  faCircleCheck,
  faCloudArrowUp,
  faPersonCircleCheck,
  faPlus,
  faRightToBracket,
  faRotate,
  faSpinner,
  faTrashCan,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type {
  IJudgeCaseResult,
  IJudgeServiceClient,
  ITestCase,
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
import { readVjudgeCases, saveVjudgeCases, type IVjudgeSettings } from './vjudgeSettings';

/** 登录态轮询间隔：登录页在 webview 中完成后尽快感知。 */
const ACCOUNT_POLL_INTERVAL_MS = 2_000;

/** 题目未给出限制时的本地预检默认值。 */
const DEFAULT_PREFLIGHT_TIME_MS = 1_000;
const DEFAULT_PREFLIGHT_MEMORY_MB = 256;

const VJUDGE_LOGIN_URL = `${VJUDGE_BASE_URL}/?login=1&continue=%2F`;

export interface IVjudgePanelProps {
  /** 当前编辑器中可提交的源（无则不可提交）。 */
  readonly resolveSource: () => IJudgeSource | undefined;
  readonly appTheme: ThemeKind;
  readonly hidden?: boolean;
  /** 本地评测服务：提交前用本地测试点先跑一遍。 */
  readonly judgeService: IJudgeServiceClient;
  readonly settings: IVjudgeSettings;
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
export function VjudgePanel({
  resolveSource,
  appTheme,
  hidden,
  judgeService,
  settings,
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
  const [busy, setBusy] = useState<'fetch' | 'submit' | 'preflight' | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [cases, setCases] = useState<readonly ITestCase[]>([]);
  const [caseInput, setCaseInput] = useState('');
  const [caseExpected, setCaseExpected] = useState('');
  const [preflightResults, setPreflightResults] = useState<readonly IJudgeCaseResult[] | undefined>(
    undefined,
  );
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [preflightPassed, setPreflightPassed] = useState(false);
  const [activated, setActivated] = useState(hidden !== true);
  const currentKeyRef = useRef('');
  const markdownRef = useRef<HTMLElement | null>(null);
  const loginStageRef = useRef<HTMLDivElement | null>(null);

  const currentKey = problem === undefined ? '' : problemKey(problem.oj, problem.probNum);
  currentKeyRef.current = currentKey;

  const addCase = useCallback((): void => {
    if (currentKey.length === 0 || caseInput.length === 0) {
      return;
    }
    const next = [
      ...cases,
      {
        expectedOutput: caseExpected,
        input: caseInput,
        name: `${WORKBENCH_STRINGS.vjudgeCasePrefix}${cases.length + 1}`,
      },
    ];
    setCases(saveVjudgeCases(currentKey, next)[currentKey] ?? []);
    setCaseInput('');
    setCaseExpected('');
    setPreflightResults(undefined);
  }, [caseExpected, caseInput, cases, currentKey]);

  const removeCase = useCallback(
    (index: number): void => {
      if (currentKey.length === 0) {
        return;
      }
      const next = cases.filter((_, position) => position !== index);
      setCases(saveVjudgeCases(currentKey, next)[currentKey] ?? []);
      setPreflightResults(undefined);
    },
    [cases, currentKey],
  );

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
      setCases(readVjudgeCases()[problemKey(next.oj, next.probNum)] ?? []);
      setPreflightResults(undefined);
      setAwaitingConfirm(false);
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

  const sendToVjudge = useCallback(
    async (source: IJudgeSource, target: IVjudgeProblem): Promise<void> => {
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
    // 提交前本地预检：用户确认后（awaitingConfirm）可跳过拦截直接提交
    if (settings.preflight && cases.length > 0 && !awaitingConfirm) {
      setBusy('preflight');
      try {
        const result = await judgeService.run({
          cases,
          content: source.content,
          language: source.language,
          memoryLimitMb:
            target.memoryLimitKb === undefined
              ? DEFAULT_PREFLIGHT_MEMORY_MB
              : Math.max(1, Math.ceil(target.memoryLimitKb / 1024)),
          timeLimitMs: target.timeLimitMs ?? DEFAULT_PREFLIGHT_TIME_MS,
        });
        setPreflightResults(result.results);
        const passed = result.compileOk && result.results.every((item) => item.verdict === 'AC');
        setPreflightPassed(passed);
        if (!passed) {
          setAwaitingConfirm(true);
          return;
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setBusy(undefined);
      }
    }
    setBusy('submit');
    setAwaitingConfirm(false);
    try {
      await sendToVjudge(source, target);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }, [
    awaitingConfirm,
    cases,
    judgeService,
    language,
    problem,
    resolveSource,
    sendToVjudge,
    settings.preflight,
  ]);

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

      {awaitingConfirm ? (
        <div
          className="oi-vjudge-confirm"
          role="alertdialog"
          aria-label={WORKBENCH_STRINGS.vjudgePreflightFailed}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.vjudgePreflightFailed}</span>
          <button
            type="button"
            className="oi-btn oi-btn-primary oi-btn-sm oi-vjudge-confirm-submit"
            disabled={busy !== undefined}
            onClick={() => void submit()}
          >
            <span>{WORKBENCH_STRINGS.vjudgeSubmitAnyway}</span>
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-btn-sm oi-vjudge-confirm-cancel"
            onClick={() => {
              setAwaitingConfirm(false);
              setBusy(undefined);
            }}
          >
            <span>{WORKBENCH_STRINGS.vjudgeCancelSubmit}</span>
          </button>
        </div>
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
          <h2 className="oi-vjudge-results-title">{WORKBENCH_STRINGS.vjudgeCases}</h2>
          {problem === undefined ? (
            <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeIdleHint}</p>
          ) : (
            <>
              {cases.length === 0 ? (
                <p className="oi-vjudge-empty">{WORKBENCH_STRINGS.vjudgeCasesEmpty}</p>
              ) : (
                <ul className="oi-vjudge-cases">
                  {cases.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="oi-vjudge-case">
                      <span className="oi-vjudge-case-name">{item.name}</span>
                      <button
                        type="button"
                        className="oi-btn oi-btn-icon oi-btn-secondary oi-btn-sm oi-vjudge-case-delete"
                        onClick={() => removeCase(index)}
                        title={WORKBENCH_STRINGS.vjudgeCaseDelete}
                        aria-label={`${WORKBENCH_STRINGS.vjudgeCaseDelete}：${item.name}`}
                      >
                        <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                className="oi-input oi-vjudge-case-input"
                rows={2}
                value={caseInput}
                placeholder={WORKBENCH_STRINGS.vjudgeCaseInput}
                aria-label={WORKBENCH_STRINGS.vjudgeCaseInput}
                onChange={(event) => setCaseInput(event.target.value)}
              />
              <textarea
                className="oi-input oi-vjudge-case-input"
                rows={2}
                value={caseExpected}
                placeholder={WORKBENCH_STRINGS.vjudgeCaseExpected}
                aria-label={WORKBENCH_STRINGS.vjudgeCaseExpected}
                onChange={(event) => setCaseExpected(event.target.value)}
              />
              <button
                type="button"
                className="oi-btn oi-btn-secondary oi-btn-sm oi-vjudge-case-add"
                onClick={addCase}
                disabled={caseInput.length === 0}
              >
                <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
                <span>{WORKBENCH_STRINGS.vjudgeCaseAdd}</span>
              </button>
              {busy === 'preflight' ? (
                <p className="oi-vjudge-empty">
                  <FontAwesomeIcon icon={faSpinner} spin aria-hidden="true" />{' '}
                  {WORKBENCH_STRINGS.vjudgePreflightRunning}
                </p>
              ) : null}
              {preflightResults !== undefined ? (
                <ul className="oi-vjudge-preflight">
                  {preflightResults.map((item, index) => (
                    <li key={item.name + '-' + String(index)} className="oi-vjudge-preflight-row">
                      <span className={'oi-vjudge-badge oi-vjudge-badge-' + item.verdict}>
                        {item.verdict}
                      </span>
                      <span className="oi-vjudge-preflight-name">{item.name}</span>
                      <span className="oi-vjudge-preflight-meta">
                        {formatNumber(item.timeMs, 'ms')} · {formatNumber(item.memoryKb, 'KB')}
                      </span>
                    </li>
                  ))}
                  {preflightPassed ? (
                    <li className="oi-vjudge-preflight-ok">
                      <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />{' '}
                      {WORKBENCH_STRINGS.vjudgePreflightPassed}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </>
          )}
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
