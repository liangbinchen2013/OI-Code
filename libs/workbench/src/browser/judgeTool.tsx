import { onUnexpectedError } from '@oi/base';
import type {
  IFileDialogService,
  IJudgeResult,
  IJudgeServiceClient,
  ITestCase,
  JudgeVerdict,
} from '@oi/platform';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleXmark,
  faFileZipper,
  faFolderOpen,
  faPen,
  faPlay,
  faPlus,
  faSpinner,
  faTrashCan,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKBENCH_STRINGS } from './strings';

export interface IJudgeSource {
  readonly name: string;
  readonly content: string;
  readonly language: 'cpp' | 'python';
}

export interface IJudgeToolProps {
  readonly hidden?: boolean;
  readonly judgeService: IJudgeServiceClient;
  readonly fileDialogService: IFileDialogService;
  /** 取当前焦点编辑器的可评测源；无有效源时返回 undefined。 */
  readonly resolveSource: () => IJudgeSource | undefined;
}

const DEFAULT_TIME_LIMIT_MS = 1000;
const DEFAULT_MEMORY_LIMIT_MB = 256;

const VERDICT_CLASS: Record<JudgeVerdict, string> = {
  AC: 'oi-verdict-ac',
  WA: 'oi-verdict-wa',
  TLE: 'oi-verdict-tle',
  MLE: 'oi-verdict-mle',
  RE: 'oi-verdict-re',
  CE: 'oi-verdict-ce',
};

function parsePositiveInt(value: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/**
 * 简易评测机：管理测试点（手动粘贴或目录/压缩包导入），
 * 一键编译当前文件并对全部测试点运行，展示逐点判定、耗时与内存。
 */
export function JudgeTool({
  hidden,
  judgeService,
  fileDialogService,
  resolveSource,
}: IJudgeToolProps) {
  const [timeLimit, setTimeLimit] = useState(String(DEFAULT_TIME_LIMIT_MS));
  const [memoryLimit, setMemoryLimit] = useState(String(DEFAULT_MEMORY_LIMIT_MB));
  const [cases, setCases] = useState<readonly ITestCase[]>([]);
  const [caseDraft, setCaseDraft] = useState<ITestCase | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<IJudgeResult | undefined>(undefined);
  const runningRef = useRef(false);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const mergeCases = useCallback((incoming: readonly ITestCase[]): void => {
    setCases((previous) => {
      const merged = new Map(previous.map((testCase) => [testCase.name, testCase]));
      for (const testCase of incoming) {
        merged.set(testCase.name, testCase);
      }
      return [...merged.values()];
    });
  }, []);

  const commitDraft = useCallback((): void => {
    if (caseDraft === undefined) {
      return;
    }
    const name = caseDraft.name.trim().length > 0 ? caseDraft.name.trim() : '测试点';
    mergeCases([{ ...caseDraft, name }]);
    setCaseDraft(undefined);
  }, [caseDraft, mergeCases]);

  const deleteCase = useCallback((name: string): void => {
    setCases((previous) => previous.filter((testCase) => testCase.name !== name));
    setCaseDraft((draft) => (draft?.name === name ? undefined : draft));
  }, []);

  const importedNotice = useCallback((count: number): void => {
    setNotice(
      count > 0
        ? WORKBENCH_STRINGS.judgeImported.replace('{count}', String(count))
        : WORKBENCH_STRINGS.judgeImportEmpty,
    );
  }, []);

  const importDirectory = useCallback(async (): Promise<void> => {
    setImporting(true);
    setNotice(undefined);
    try {
      const uri = await fileDialogService.showOpenFolder({
        title: WORKBENCH_STRINGS.judgeImportFolder,
      });
      if (uri === undefined) {
        return;
      }
      const imported = await judgeService.importDirectory(uri);
      mergeCases(imported);
      importedNotice(imported.length);
    } catch (error) {
      onUnexpectedError(error);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }, [fileDialogService, importedNotice, judgeService, mergeCases]);

  const importArchive = useCallback(async (): Promise<void> => {
    setImporting(true);
    setNotice(undefined);
    try {
      const uri = await fileDialogService.showOpenFile({
        title: WORKBENCH_STRINGS.judgeImportArchive,
        filters: [{ name: WORKBENCH_STRINGS.judgeZipFilter, extensions: ['zip'] }],
      });
      if (uri === undefined) {
        return;
      }
      const imported = await judgeService.importArchive(uri);
      mergeCases(imported);
      importedNotice(imported.length);
    } catch (error) {
      onUnexpectedError(error);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }, [fileDialogService, importedNotice, judgeService, mergeCases]);

  const runJudge = useCallback(async (): Promise<void> => {
    if (runningRef.current) {
      return;
    }
    const source = resolveSource();
    if (source === undefined) {
      setNotice(WORKBENCH_STRINGS.judgeNoSource);
      return;
    }
    if (cases.length === 0) {
      setNotice(WORKBENCH_STRINGS.judgeCasesEmpty);
      return;
    }
    setRunning(true);
    setNotice(undefined);
    setResult(undefined);
    try {
      const judged = await judgeService.run({
        content: source.content,
        language: source.language,
        timeLimitMs: parsePositiveInt(timeLimit, DEFAULT_TIME_LIMIT_MS, 60_000),
        memoryLimitMb: parsePositiveInt(memoryLimit, DEFAULT_MEMORY_LIMIT_MB, 4096),
        cases,
      });
      setResult(judged);
    } catch (error) {
      onUnexpectedError(error);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }, [cases, judgeService, memoryLimit, resolveSource, timeLimit]);

  return (
    <section className="oi-judge" hidden={hidden} aria-label={WORKBENCH_STRINGS.toolJudge}>
      <div className="oi-settings-rows">
        <div className="oi-settings-row">
          <label className="oi-settings-label" htmlFor="oi-judge-time">
            {WORKBENCH_STRINGS.judgeTimeLimit}
          </label>
          <input
            id="oi-judge-time"
            className="oi-input oi-judge-time"
            type="number"
            min={100}
            max={60000}
            step={100}
            value={timeLimit}
            onChange={(event) => setTimeLimit(event.target.value)}
          />
        </div>
        <div className="oi-settings-row">
          <label className="oi-settings-label" htmlFor="oi-judge-memory">
            {WORKBENCH_STRINGS.judgeMemoryLimit}
          </label>
          <input
            id="oi-judge-memory"
            className="oi-input oi-judge-memory"
            type="number"
            min={0}
            max={4096}
            step={16}
            value={memoryLimit}
            onChange={(event) => setMemoryLimit(event.target.value)}
          />
        </div>
      </div>

      <div className="oi-settings-actions oi-judge-imports">
        <button
          type="button"
          className="oi-btn oi-btn-secondary oi-judge-add"
          onClick={() =>
            setCaseDraft({
              name: `${WORKBENCH_STRINGS.judgeCasePrefix}${cases.length + 1}`,
              input: '',
              expectedOutput: '',
            })
          }
        >
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.judgeAddCase}</span>
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-secondary oi-judge-import-folder"
          onClick={() => void importDirectory()}
          disabled={importing || running}
        >
          <FontAwesomeIcon
            icon={importing ? faSpinner : faFolderOpen}
            spin={importing}
            aria-hidden="true"
          />
          <span>{WORKBENCH_STRINGS.judgeImportFolder}</span>
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-secondary oi-judge-import-zip"
          onClick={() => void importArchive()}
          disabled={importing || running}
        >
          <FontAwesomeIcon
            icon={importing ? faSpinner : faFileZipper}
            spin={importing}
            aria-hidden="true"
          />
          <span>{WORKBENCH_STRINGS.judgeImportArchive}</span>
        </button>
        {cases.length > 0 ? (
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-judge-clear"
            onClick={() => {
              setCases([]);
              setResult(undefined);
            }}
            disabled={running}
          >
            <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.judgeClear}</span>
          </button>
        ) : null}
      </div>

      {caseDraft !== undefined ? (
        <div className="oi-judge-editor">
          <label className="oi-field">
            <span className="oi-settings-label">{WORKBENCH_STRINGS.judgeCaseName}</span>
            <input
              className="oi-input oi-judge-name"
              type="text"
              value={caseDraft.name}
              onChange={(event) => setCaseDraft({ ...caseDraft, name: event.target.value })}
            />
          </label>
          <label className="oi-field">
            <span className="oi-settings-label">{WORKBENCH_STRINGS.judgeCaseInput}</span>
            <textarea
              className="oi-input oi-judge-input"
              rows={4}
              value={caseDraft.input}
              placeholder={WORKBENCH_STRINGS.judgeCaseInputPlaceholder}
              onChange={(event) => setCaseDraft({ ...caseDraft, input: event.target.value })}
            />
          </label>
          <label className="oi-field">
            <span className="oi-settings-label">{WORKBENCH_STRINGS.judgeCaseExpected}</span>
            <textarea
              className="oi-input oi-judge-expected"
              rows={4}
              value={caseDraft.expectedOutput}
              placeholder={WORKBENCH_STRINGS.judgeCaseExpectedPlaceholder}
              onChange={(event) =>
                setCaseDraft({ ...caseDraft, expectedOutput: event.target.value })
              }
            />
          </label>
          <div className="oi-settings-actions">
            <button
              type="button"
              className="oi-btn oi-btn-primary oi-judge-save"
              onClick={commitDraft}
            >
              <span>{WORKBENCH_STRINGS.judgeCaseSave}</span>
            </button>
            <button
              type="button"
              className="oi-btn oi-btn-secondary"
              onClick={() => setCaseDraft(undefined)}
            >
              <span>{WORKBENCH_STRINGS.judgeCaseCancel}</span>
            </button>
          </div>
        </div>
      ) : null}

      {cases.length > 0 ? (
        <div className="oi-judge-cases">
          {cases.map((testCase) => (
            <div key={testCase.name} className="oi-radio-row oi-judge-case-row">
              <span className="oi-judge-case-name" title={testCase.name}>
                {testCase.name}
              </span>
              <span className="oi-candidate-source">
                {testCase.input.length}B / {testCase.expectedOutput.length}B
              </span>
              <button
                type="button"
                className="oi-btn oi-btn-icon oi-btn-secondary oi-judge-case-edit"
                onClick={() => setCaseDraft({ ...testCase })}
                title={`${WORKBENCH_STRINGS.judgeCaseEdit}：${testCase.name}`}
                aria-label={`${WORKBENCH_STRINGS.judgeCaseEdit}：${testCase.name}`}
              >
                <FontAwesomeIcon icon={faPen} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="oi-btn oi-btn-icon oi-btn-secondary oi-judge-case-delete"
                onClick={() => deleteCase(testCase.name)}
                title={`${WORKBENCH_STRINGS.judgeCaseDelete}：${testCase.name}`}
                aria-label={`${WORKBENCH_STRINGS.judgeCaseDelete}：${testCase.name}`}
              >
                <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="oi-settings-hint oi-judge-empty">{WORKBENCH_STRINGS.judgeCasesEmpty}</p>
      )}

      {notice !== undefined ? <p className="oi-settings-hint oi-judge-notice">{notice}</p> : null}

      <div className="oi-settings-actions">
        <button
          type="button"
          className="oi-btn oi-btn-primary oi-judge-run"
          onClick={() => void runJudge()}
          disabled={running || importing}
        >
          <FontAwesomeIcon icon={running ? faSpinner : faPlay} spin={running} aria-hidden="true" />
          <span>{running ? WORKBENCH_STRINGS.judgeRunning : WORKBENCH_STRINGS.judgeRun}</span>
        </button>
      </div>

      {result !== undefined ? (
        <div className="oi-judge-results">
          <p className="oi-settings-hint">
            {result.compileOk ? result.compileMessage : WORKBENCH_STRINGS.judgeCompileFailed}
          </p>
          {result.results.map((caseResult) => (
            <div key={caseResult.name} className="oi-radio-row oi-judge-result-row">
              <FontAwesomeIcon
                icon={
                  caseResult.verdict === 'AC'
                    ? faCircleCheck
                    : caseResult.verdict === 'CE'
                      ? faTriangleExclamation
                      : faCircleXmark
                }
                className={`oi-judge-verdict ${VERDICT_CLASS[caseResult.verdict]}`}
                aria-hidden="true"
              />
              <span className="oi-judge-case-name" title={caseResult.name}>
                {caseResult.name}
              </span>
              <span className={`oi-judge-verdict-text ${VERDICT_CLASS[caseResult.verdict]}`}>
                {caseResult.verdict}
              </span>
              <span className="oi-candidate-source">
                {caseResult.timeMs === undefined
                  ? ''
                  : WORKBENCH_STRINGS.judgeTimeMs.replace('{time}', String(caseResult.timeMs))}
              </span>
              {caseResult.memoryKb !== undefined ? (
                <span className="oi-candidate-source">
                  {WORKBENCH_STRINGS.judgeMemoryKb.replace(
                    '{memory}',
                    String(Math.round(caseResult.memoryKb / 1024)),
                  )}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
