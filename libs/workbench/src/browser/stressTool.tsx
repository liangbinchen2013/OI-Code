import { onUnexpectedError } from '@oi/base';
import type { URI } from '@oi/base';
import type { IFileDialogService, IJudgeServiceClient, IStressResult } from '@oi/platform';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleXmark,
  faFileCode,
  faPlay,
  faSpinner,
  faStop,
} from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { WORKBENCH_STRINGS } from './strings';

export interface IStressToolProps {
  readonly hidden?: boolean;
  readonly judgeService: IJudgeServiceClient;
  readonly fileDialogService: IFileDialogService;
}

interface IChosenProgram {
  readonly uri: URI;
  readonly name: string;
}

const DEFAULT_ITERATIONS = 100;
const DEFAULT_TIME_LIMIT_MS = 1000;
const OUTPUT_PREVIEW_CHARS = 4000;

function fileNameOf(uri: URI): string {
  const name = uri.path.split('/').pop();
  return name !== undefined && name.length > 0 ? name : uri.path;
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function preview(text: string | undefined): string {
  if (text === undefined) {
    return '';
  }
  return text.length > OUTPUT_PREVIEW_CHARS
    ? `${text.slice(0, OUTPUT_PREVIEW_CHARS)}\n…（已截断）`
    : text;
}

/**
 * 对拍：数据生成器 + 标准程序 + 待测程序逐轮比对，
 * 发现不一致时展示该轮输入与两侧输出。
 */
export function StressTool({ hidden, judgeService, fileDialogService }: IStressToolProps) {
  const [generator, setGenerator] = useState<IChosenProgram | undefined>(undefined);
  const [reference, setReference] = useState<IChosenProgram | undefined>(undefined);
  const [solution, setSolution] = useState<IChosenProgram | undefined>(undefined);
  const [iterations, setIterations] = useState(String(DEFAULT_ITERATIONS));
  const [timeLimit, setTimeLimit] = useState(String(DEFAULT_TIME_LIMIT_MS));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<IStressResult | undefined>(undefined);

  useEffect(() => {
    const subscription = judgeService.onDidStressProgress((update) => {
      if (update.phase === 'compiling') {
        setProgress(WORKBENCH_STRINGS.stressCompiling);
        return;
      }
      if (update.phase === 'finished') {
        setProgress(undefined);
        return;
      }
      setProgress(
        WORKBENCH_STRINGS.stressProgress
          .replace('{iteration}', String(update.iteration))
          .replace('{total}', String(update.total)),
      );
    });
    return () => subscription.dispose();
  }, [judgeService]);

  const pickProgram = useCallback(
    async (title: string): Promise<IChosenProgram | undefined> => {
      const uri = await fileDialogService.showOpenFile({
        title,
        filters: [
          {
            name: WORKBENCH_STRINGS.stressProgramFilter,
            extensions: ['cpp', 'cc', 'cxx', 'c', 'py'],
          },
        ],
      });
      return uri === undefined ? undefined : { uri, name: fileNameOf(uri) };
    },
    [fileDialogService],
  );

  const start = useCallback(async (): Promise<void> => {
    if (generator === undefined || reference === undefined || solution === undefined) {
      setNotice(WORKBENCH_STRINGS.stressNeedPrograms);
      return;
    }
    setRunning(true);
    setNotice(undefined);
    setResult(undefined);
    try {
      setResult(
        await judgeService.stress({
          generatorUri: generator.uri,
          referenceUri: reference.uri,
          solutionUri: solution.uri,
          iterations: clampInt(iterations, DEFAULT_ITERATIONS, 1, 10_000),
          timeLimitMs: clampInt(timeLimit, DEFAULT_TIME_LIMIT_MS, 100, 60_000),
        }),
      );
    } catch (error) {
      onUnexpectedError(error);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      setProgress(undefined);
    }
  }, [generator, iterations, judgeService, reference, solution, timeLimit]);

  const renderTarget = (
    label: string,
    chosen: IChosenProgram | undefined,
    ariaClass: string,
    onPick: () => void,
  ): ReactElement => (
    <div className="oi-stress-target">
      <span className="oi-settings-label">{label}</span>
      <button
        type="button"
        className={`oi-btn oi-btn-secondary oi-stress-pick ${ariaClass}`}
        onClick={onPick}
        disabled={running}
        title={chosen?.uri.toString() ?? WORKBENCH_STRINGS.stressPick}
      >
        <FontAwesomeIcon icon={faFileCode} aria-hidden="true" />
        <span className="oi-stress-target-name">
          {chosen?.name ?? WORKBENCH_STRINGS.stressNotChosen}
        </span>
      </button>
    </div>
  );

  return (
    <section className="oi-stress" hidden={hidden} aria-label={WORKBENCH_STRINGS.toolStress}>
      <div className="oi-stress-targets">
        {renderTarget(WORKBENCH_STRINGS.stressGenerator, generator, 'oi-stress-generator', () => {
          void pickProgram(WORKBENCH_STRINGS.stressGenerator).then((chosen) => {
            if (chosen !== undefined) {
              setGenerator(chosen);
            }
          });
        })}
        {renderTarget(WORKBENCH_STRINGS.stressReference, reference, 'oi-stress-reference', () => {
          void pickProgram(WORKBENCH_STRINGS.stressReference).then((chosen) => {
            if (chosen !== undefined) {
              setReference(chosen);
            }
          });
        })}
        {renderTarget(WORKBENCH_STRINGS.stressSolution, solution, 'oi-stress-solution', () => {
          void pickProgram(WORKBENCH_STRINGS.stressSolution).then((chosen) => {
            if (chosen !== undefined) {
              setSolution(chosen);
            }
          });
        })}
      </div>

      <div className="oi-settings-rows">
        <div className="oi-settings-row">
          <label className="oi-settings-label" htmlFor="oi-stress-iterations">
            {WORKBENCH_STRINGS.stressIterations}
          </label>
          <input
            id="oi-stress-iterations"
            className="oi-input oi-stress-iterations"
            type="number"
            min={1}
            max={10000}
            value={iterations}
            onChange={(event) => setIterations(event.target.value)}
            disabled={running}
          />
        </div>
        <div className="oi-settings-row">
          <label className="oi-settings-label" htmlFor="oi-stress-time">
            {WORKBENCH_STRINGS.stressTimeLimit}
          </label>
          <input
            id="oi-stress-time"
            className="oi-input oi-stress-time"
            type="number"
            min={100}
            max={60000}
            step={100}
            value={timeLimit}
            onChange={(event) => setTimeLimit(event.target.value)}
            disabled={running}
          />
        </div>
      </div>

      {notice !== undefined ? <p className="oi-settings-hint oi-stress-notice">{notice}</p> : null}
      {progress !== undefined ? (
        <p className="oi-settings-hint oi-stress-progress">{progress}</p>
      ) : null}

      <div className="oi-settings-actions">
        <button
          type="button"
          className="oi-btn oi-btn-primary oi-stress-start"
          onClick={() => void start()}
          disabled={running}
        >
          <FontAwesomeIcon icon={running ? faSpinner : faPlay} spin={running} aria-hidden="true" />
          <span>{running ? WORKBENCH_STRINGS.stressRunning : WORKBENCH_STRINGS.stressStart}</span>
        </button>
        {running ? (
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-stress-stop"
            onClick={() => void judgeService.cancelStress().catch(onUnexpectedError)}
          >
            <FontAwesomeIcon icon={faStop} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.stressStop}</span>
          </button>
        ) : null}
      </div>

      {result !== undefined ? (
        <div className="oi-stress-result">
          <p
            className={`oi-settings-hint oi-stress-summary ${result.ok ? 'oi-verdict-ac' : 'oi-verdict-wa'}`}
          >
            <FontAwesomeIcon icon={result.ok ? faCircleCheck : faCircleXmark} aria-hidden="true" />
            <span>
              {result.ok
                ? WORKBENCH_STRINGS.stressPassed.replace('{total}', String(result.total))
                : result.failedIteration !== undefined
                  ? WORKBENCH_STRINGS.stressFailedAt.replace(
                      '{iteration}',
                      String(result.failedIteration),
                    )
                  : result.message}
            </span>
          </p>
          {result.failedIteration !== undefined ? (
            <>
              <span className="oi-settings-label">{WORKBENCH_STRINGS.stressInput}</span>
              <pre className="oi-stress-output oi-stress-input-data">{preview(result.input)}</pre>
              <span className="oi-settings-label">{WORKBENCH_STRINGS.stressExpectedOutput}</span>
              <pre className="oi-stress-output oi-stress-expected-data">
                {preview(result.referenceOutput)}
              </pre>
              <span className="oi-settings-label">{WORKBENCH_STRINGS.stressActualOutput}</span>
              <pre className="oi-stress-output oi-stress-actual-data">
                {preview(result.solutionOutput)}
              </pre>
            </>
          ) : (
            <p className="oi-settings-hint">{result.message}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
