import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolderTree, faGear } from '@fortawesome/free-solid-svg-icons';
import { WORKBENCH_STRINGS } from './strings';

/**
 * 侧边栏一级视图：资源管理器 / 设置（后续 OI 工具箱等在此扩展）。
 */
export type ActivityView = 'explorer' | 'settings';

export interface IActivityItem {
  readonly view: ActivityView;
  readonly icon: IconDefinition;
  readonly label: string;
}

const ACTIVITY_ITEMS: readonly IActivityItem[] = [
  { view: 'explorer', icon: faFolderTree, label: WORKBENCH_STRINGS.explorer },
];

export interface IActivityBarProps {
  readonly activeView: ActivityView;
  readonly onSelect: (view: ActivityView) => void;
}

/**
 * 活动栏：侧边栏一级导航（顶部工具组 + 底部设置）。
 */
export function ActivityBar({ activeView, onSelect }: IActivityBarProps) {
  return (
    <nav className="oi-activitybar" aria-label="活动栏">
      <div className="oi-activitybar-top">
        {ACTIVITY_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`oi-activity-item${activeView === item.view ? ' oi-activity-item-active' : ''}`}
            onClick={() => onSelect(item.view)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={activeView === item.view}
          >
            <FontAwesomeIcon icon={item.icon} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`oi-activity-item oi-activity-item-settings${
          activeView === 'settings' ? ' oi-activity-item-active' : ''
        }`}
        onClick={() => onSelect('settings')}
        title={WORKBENCH_STRINGS.settings}
        aria-label={WORKBENCH_STRINGS.settings}
        aria-pressed={activeView === 'settings'}
      >
        <FontAwesomeIcon icon={faGear} aria-hidden="true" />
      </button>
    </nav>
  );
}
