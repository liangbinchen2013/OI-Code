import type { URI } from '@oi/base';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBolt,
  faCode,
  faFile,
  faFileCode,
  faFileLines,
  faGripLines,
  faHammer,
  faPlay,
  faPlus,
  faTableColumns,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { SplitDirection } from './layout';
import { WORKBENCH_STRINGS } from './strings';
import type { IFileTemplate } from './templates';

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
  /** 当前分屏方向；null 表示未开启分屏。 */
  readonly splitDirection: SplitDirection | null;
  /** 分屏按钮：关闭 → 左右 → 上下 → 关闭循环切换。 */
  readonly onCycleSplit: () => void;
  readonly templates: readonly IFileTemplate[];
  readonly newMenuOpen: boolean;
  readonly onToggleNewMenu: () => void;
  readonly onCloseNewMenu: () => void;
  /** + 菜单固定项：创建无后缀的「文件」。 */
  readonly onCreateUntitled: () => void;
  readonly onCreateFromTemplate: (template: IFileTemplate) => void;
}

function templateIcon(template: IFileTemplate): IconDefinition {
  if (template.extension === 'cpp') {
    return faFileCode;
  }
  if (template.extension === 'py') {
    return faCode;
  }
  return faFileLines;
}

/**
 * 顶部文件栏：标签页 + 新建（模板菜单）+ 编译/运行/编译并运行 + 问题面板开关。
 */
export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  actionsEnabled,
  busy,
  problemCount,
  problemsOpen,
  onCompile,
  onRun,
  onCompileRun,
  onToggleProblems,
  splitDirection,
  onCycleSplit,
  templates,
  newMenuOpen,
  onToggleNewMenu,
  onCloseNewMenu,
  onCreateUntitled,
  onCreateFromTemplate,
}: ITabBarProps) {
  const actionDisabled = !actionsEnabled || busy;
  const splitTitle =
    splitDirection === null
      ? WORKBENCH_STRINGS.splitEnable
      : splitDirection === 'horizontal'
        ? WORKBENCH_STRINGS.splitToVertical
        : WORKBENCH_STRINGS.splitDisable;

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
        <div className="oi-new-container">
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-tab-new"
            onClick={onToggleNewMenu}
            title={WORKBENCH_STRINGS.newFileTooltip}
            aria-label={WORKBENCH_STRINGS.newFile}
            aria-expanded={newMenuOpen}
            aria-haspopup="menu"
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
          </button>
          {newMenuOpen ? (
            <>
              <div className="oi-menu-backdrop" onClick={onCloseNewMenu} aria-hidden="true" />
              <div className="oi-menu" role="menu" aria-label={WORKBENCH_STRINGS.newFileMenuLabel}>
                <button
                  type="button"
                  role="menuitem"
                  className="oi-menu-item oi-menu-plain-file"
                  onClick={onCreateUntitled}
                >
                  <FontAwesomeIcon icon={faFile} aria-hidden="true" />
                  <span className="oi-menu-label">{WORKBENCH_STRINGS.newPlainFile}</span>
                </button>
                {templates.length > 0 ? (
                  <span className="oi-menu-divider" aria-hidden="true" />
                ) : null}
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    role="menuitem"
                    className="oi-menu-item"
                    onClick={() => onCreateFromTemplate(template)}
                  >
                    <FontAwesomeIcon icon={templateIcon(template)} aria-hidden="true" />
                    <span className="oi-menu-label">{template.name}</span>
                    {template.extension.length > 0 ? (
                      <span className="oi-menu-hint">.{template.extension}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
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
        <span className="oi-tabbar-separator" aria-hidden="true" />
        <button
          type="button"
          className={`oi-btn oi-btn-icon oi-split-toggle${
            splitDirection !== null ? ' oi-split-toggle-active' : ''
          }`}
          onClick={onCycleSplit}
          disabled={!actionsEnabled}
          title={splitTitle}
          aria-label={WORKBENCH_STRINGS.split}
        >
          <FontAwesomeIcon
            icon={splitDirection === 'vertical' ? faGripLines : faTableColumns}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
