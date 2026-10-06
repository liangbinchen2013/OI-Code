import type { URI } from '@oi/base';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
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
}

/**
 * 顶部文件栏：文件标签 + 新建按钮（不含品牌与操作按钮）。
 */
export function TabBar({ tabs, activeTabId, onActivate, onClose, onNew }: ITabBarProps) {
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
      <button
        type="button"
        className="oi-btn oi-btn-icon oi-tab-new"
        onClick={onNew}
        title={WORKBENCH_STRINGS.newFileTooltip}
        aria-label={WORKBENCH_STRINGS.newFile}
      >
        <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
      </button>
    </div>
  );
}
