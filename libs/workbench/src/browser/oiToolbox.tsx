import type { IFileDialogService, IJudgeServiceClient } from '@oi/platform';
import type { ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faClipboardCheck,
  faEarthAsia,
  faHourglassHalf,
  faPause,
  faPlay,
  faRotateLeft,
  faStopwatch,
} from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserTool } from './browserTool';
import { JudgeTool, type IJudgeSource } from './judgeTool';
import { WORKBENCH_STRINGS } from './strings';

type ToolboxTool = 'list' | 'judge' | 'timer' | 'browser';
type TimerMode = 'stopwatch' | 'countdown';

const TICK_INTERVAL_MS = 50;

/**
 * 时间显示：`mm:ss.d`；超过一小时显示 `hh:mm:ss.d`。
 */
export function formatDuration(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const totalTenths = Math.floor(safe / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${tenths}`
    : `${pad(minutes)}:${pad(seconds)}.${tenths}`;
}

/**
 * 计时器：正计时与倒计时；运行期间以 50ms 刷新，倒计时归零停表并提示。
 */
function TimerTool() {
  const [mode, setMode] = useState<TimerMode>('stopwatch');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [countdownMinutes, setCountdownMinutes] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(30);
  const elapsedRef = useRef(elapsedMs);

  useEffect(() => {
    elapsedRef.current = elapsedMs;
  }, [elapsedMs]);

  const countdownLimitMs = (countdownMinutes * 60 + countdownSeconds) * 1000;

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const startedAt = Date.now() - elapsedRef.current;
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAt;
      if (mode === 'countdown' && next >= countdownLimitMs) {
        setElapsedMs(countdownLimitMs);
        setRunning(false);
        setFinished(true);
        return;
      }
      setElapsedMs(next);
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, mode, countdownLimitMs]);

  const toggleRunning = useCallback((): void => {
    if (finished) {
      setFinished(false);
      setElapsedMs(0);
      setRunning(true);
      return;
    }
    setRunning((previous) => !previous);
  }, [finished]);

  const reset = useCallback((): void => {
    setRunning(false);
    setFinished(false);
    setElapsedMs(0);
  }, []);

  const switchMode = useCallback((next: TimerMode): void => {
    setMode(next);
    setRunning(false);
    setFinished(false);
    setElapsedMs(0);
  }, []);

  const displayMs = mode === 'countdown' ? Math.max(0, countdownLimitMs - elapsedMs) : elapsedMs;
  const countdownInvalid = mode === 'countdown' && countdownLimitMs <= 0;

  return (
    <div className="oi-timer">
      <div className="oi-timer-modes" role="tablist" aria-label={WORKBENCH_STRINGS.toolTimer}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'stopwatch'}
          className={`oi-timer-mode oi-timer-stopwatch${mode === 'stopwatch' ? ' oi-timer-mode-active' : ''}`}
          onClick={() => switchMode('stopwatch')}
        >
          <FontAwesomeIcon icon={faStopwatch} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.toolTimerStopwatch}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'countdown'}
          className={`oi-timer-mode oi-timer-countdown${mode === 'countdown' ? ' oi-timer-mode-active' : ''}`}
          onClick={() => switchMode('countdown')}
        >
          <FontAwesomeIcon icon={faHourglassHalf} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.toolTimerCountdown}</span>
        </button>
      </div>

      <div
        className={`oi-timer-display${finished ? ' oi-timer-display-finished' : ''}`}
        role="timer"
        aria-live="off"
      >
        {formatDuration(displayMs)}
      </div>
      {finished ? (
        <p className="oi-timer-finished-text">{WORKBENCH_STRINGS.toolTimerFinished}</p>
      ) : null}

      {mode === 'countdown' ? (
        <div className="oi-timer-inputs">
          <label className="oi-field">
            <span className="oi-settings-label">{WORKBENCH_STRINGS.toolTimerMinutes}</span>
            <input
              className="oi-input oi-timer-minutes"
              type="number"
              min={0}
              max={999}
              value={countdownMinutes}
              disabled={running}
              onChange={(event) =>
                setCountdownMinutes(
                  Math.max(0, Math.min(999, Number.parseInt(event.target.value, 10) || 0)),
                )
              }
            />
          </label>
          <label className="oi-field">
            <span className="oi-settings-label">{WORKBENCH_STRINGS.toolTimerSeconds}</span>
            <input
              className="oi-input oi-timer-seconds"
              type="number"
              min={0}
              max={59}
              value={countdownSeconds}
              disabled={running}
              onChange={(event) =>
                setCountdownSeconds(
                  Math.max(0, Math.min(59, Number.parseInt(event.target.value, 10) || 0)),
                )
              }
            />
          </label>
        </div>
      ) : null}

      <div className="oi-timer-controls">
        <button
          type="button"
          className="oi-btn oi-btn-primary oi-timer-toggle"
          onClick={toggleRunning}
          disabled={countdownInvalid}
        >
          <FontAwesomeIcon icon={running ? faPause : faPlay} aria-hidden="true" />
          <span>
            {running ? WORKBENCH_STRINGS.toolTimerPause : WORKBENCH_STRINGS.toolTimerStart}
          </span>
        </button>
        <button type="button" className="oi-btn oi-btn-secondary oi-timer-reset" onClick={reset}>
          <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.toolTimerReset}</span>
        </button>
      </div>
    </div>
  );
}

export interface IToolboxPanelProps {
  readonly hidden?: boolean;
  /** OI-Code 当前主题，透传给内置浏览器。 */
  readonly appTheme: ThemeKind;
  readonly judgeService: IJudgeServiceClient;
  readonly fileDialogService: IFileDialogService;
  /** 取当前焦点编辑器的可评测源。 */
  readonly resolveJudgeSource: () => IJudgeSource | undefined;
}

/**
 * OI 工具箱面板（侧边栏二级）：工具选择 → 工具内容（三级）。
 * 保持挂载以便切换视图时计时器继续运行。
 */
export function ToolboxPanel({
  hidden,
  appTheme,
  judgeService,
  fileDialogService,
  resolveJudgeSource,
}: IToolboxPanelProps) {
  const [tool, setTool] = useState<ToolboxTool>('list');
  // 浏览器一经打开保持挂载：切换工具/视图不丢页面状态，登录态由持久化分区保存
  const [browserStarted, setBrowserStarted] = useState(false);

  return (
    <section className="oi-panel oi-toolbox" hidden={hidden} aria-label={WORKBENCH_STRINGS.toolbox}>
      <div className="oi-sidebar-header">
        <span className="oi-sidebar-title">{WORKBENCH_STRINGS.toolbox}</span>
        {tool !== 'list' ? (
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-btn-secondary oi-toolbox-back"
            onClick={() => setTool('list')}
            title={WORKBENCH_STRINGS.toolboxBack}
            aria-label={WORKBENCH_STRINGS.toolboxBack}
          >
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="oi-toolbox-body">
        {browserStarted ? <BrowserTool hidden={tool !== 'browser'} appTheme={appTheme} /> : null}
        {tool === 'list' ? (
          <div className="oi-tool-list">
            <button
              type="button"
              className="oi-tool-row oi-tool-judge"
              onClick={() => setTool('judge')}
            >
              <FontAwesomeIcon icon={faClipboardCheck} aria-hidden="true" />
              <span className="oi-tool-name">{WORKBENCH_STRINGS.toolJudge}</span>
              <span className="oi-tool-hint">{WORKBENCH_STRINGS.toolJudgeHint}</span>
            </button>
            <button
              type="button"
              className="oi-tool-row oi-tool-browser"
              onClick={() => {
                setBrowserStarted(true);
                setTool('browser');
              }}
            >
              <FontAwesomeIcon icon={faEarthAsia} aria-hidden="true" />
              <span className="oi-tool-name">{WORKBENCH_STRINGS.toolBrowser}</span>
              <span className="oi-tool-hint">{WORKBENCH_STRINGS.toolBrowserHint}</span>
            </button>
            <button
              type="button"
              className="oi-tool-row oi-tool-timer"
              onClick={() => setTool('timer')}
            >
              <FontAwesomeIcon icon={faStopwatch} aria-hidden="true" />
              <span className="oi-tool-name">{WORKBENCH_STRINGS.toolTimer}</span>
              <span className="oi-tool-hint">{WORKBENCH_STRINGS.toolTimerHint}</span>
            </button>
          </div>
        ) : null}
        {tool === 'judge' ? (
          <JudgeTool
            judgeService={judgeService}
            fileDialogService={fileDialogService}
            resolveSource={resolveJudgeSource}
          />
        ) : null}
        {tool === 'timer' ? <TimerTool /> : null}
      </div>
    </section>
  );
}
