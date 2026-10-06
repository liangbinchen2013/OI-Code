import type { URI } from '@oi/base';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBolt,
  faHammer,
  faPlay,
  faPlus,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { WORKBENCH_STRINGS } from './strings';

/**
 * 标签页描述：id 在标签生命周期内稳定，另存为后 uri/name 会更新。
 */
export interface ITabDescriptor {
  readonly id: string;
  readonly uri: URI;
  readonly name: string;
  readonly dirty: boolean;
}

export interface ITabBarProps {
  readonly tabs: readonly ITabDescriptor[];
  readonly activeTabId: string | undefined;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNew: () => void;
  /** 有可编译运行的当前文件且无进行中动作时按钮可用。 */
  readonly actionsEnabled: boolean;
  /** 有动作进行中（编译/运行），按钮显示为禁用。 */
  readonly busy: boolean;
  readonly problemCount: number;
  readonly problemsOpen: boolean;
  readonly onCompile: () => void;
  readonly onRun: () => void;
  readonly onCompileRun: () => void;
  readonly onToggleProblems: () => void;
}

/**
 * 顶部文件栏：标签页 + 新建 + 编译/运行/编译并运行 + 问题面板开关。
 */
export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNew,
  actionsEnabled,
  busy,
  problemCount,
  problemsOpen,
  onCompile,
  onRun,
  onCompileRun,
  onToggleProblems,
}: ITabBarProps) {
  const actionDisabled = !actionsEnabled || busy;

  return (
    <div className="oi-tabbar">
      <div className="oi-tabbar-tabs" role="tablist" aria-label="已打开的文件">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={`oi-tab${tab.id === activeTabId ? ' oi-tab-active' : ''}`}
            title={tab.uri.toString()}
          >
            <button type="button" className="oi-tab-label" onClick={() => onActivate(tab.id)}>
              <span className="oi-tab-name">{tab.name}</span>
              {tab.dirty ? (
                <span className="oi-dirty-dot" role="img" aria-label={WORKBENCH_STRINGS.unsaved} />
              ) : null}
            </button>
            <button
              type="button"
              className="oi-tab-close"
              onClick={() => onClose(tab.id)}
              title={`${WORKBENCH_STRINGS.closeTab}：${tab.name}`}
              aria-label={`${WORKBENCH_STRINGS.closeTab}：${tab.name}`}
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div className="oi-tabbar-actions">
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-tab-new"
          onClick={onNew}
          title={WORKBENCH_STRINGS.newFileTooltip}
          aria-label={WORKBENCH_STRINGS.newFile}
        >
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
        </button>
        <span className="oi-tabbar-separator" aria-hidden="true" />
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-action-compile"
          onClick={onCompile}
          disabled={actionDisabled}
          title={WORKBENCH_STRINGS.compileTooltip}
          aria-label={WORKBENCH_STRINGS.compile}
        >
          <FontAwesomeIcon icon={faHammer} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-action-run"
          onClick={onRun}
          disabled={actionDisabled}
          title={WORKBENCH_STRINGS.runTooltip}
          aria-label={WORKBENCH_STRINGS.run}
        >
          <FontAwesomeIcon icon={faPlay} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-action-compile-run"
          onClick={onCompileRun}
          disabled={actionDisabled}
          title={WORKBENCH_STRINGS.compileRunTooltip}
          aria-label={WORKBENCH_STRINGS.compileRun}
        >
          <FontAwesomeIcon icon={faBolt} aria-hidden="true" />
        </button>
        <span className="oi-tabbar-separator" aria-hidden="true" />
        <button
          type="button"
          className={`oi-btn oi-btn-icon oi-problems-toggle${
            problemsOpen ? ' oi-problems-toggle-active' : ''
          }`}
          onClick={onToggleProblems}
          title={WORKBENCH_STRINGS.problemsTooltip}
          aria-label={WORKBENCH_STRINGS.problems}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          {problemCount > 0 ? <span className="oi-problems-badge">{problemCount}</span> : null}
        </button>
      </div>
    </div>
  );
}
