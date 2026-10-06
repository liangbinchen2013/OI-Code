import type { ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileLines,
  faFloppyDisk,
  faFolderOpen,
  faMoon,
  faSun,
} from '@fortawesome/free-solid-svg-icons';
import { WORKBENCH_STRINGS } from './strings';

export interface ISettingsViewProps {
  readonly theme: ThemeKind;
  readonly canSave: boolean;
  readonly onToggleTheme: () => void;
  readonly onOpenFile: () => void;
  readonly onOpenFolder: () => void;
  readonly onSave: () => void;
}

/**
 * 设置页：外观（主题切换）与文件操作（打开 / 打开文件夹 / 保存）。
 */
export function SettingsView({
  theme,
  canSave,
  onToggleTheme,
  onOpenFile,
  onOpenFolder,
  onSave,
}: ISettingsViewProps) {
  const themeToggleText =
    theme === 'dark' ? WORKBENCH_STRINGS.themeToLight : WORKBENCH_STRINGS.themeToDark;

  return (
    <div className="oi-settings">
      <div className="oi-settings-card">
        <h1 className="oi-settings-title">{WORKBENCH_STRINGS.settings}</h1>
        <section className="oi-settings-section">
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.settingsAppearance}</h2>
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-theme-toggle"
            onClick={onToggleTheme}
            title={themeToggleText}
            aria-label={themeToggleText}
          >
            <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} aria-hidden="true" />
            <span>{themeToggleText}</span>
          </button>
        </section>
        <section className="oi-settings-section">
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.settingsFiles}</h2>
          <div className="oi-settings-actions">
            <button
              type="button"
              className="oi-btn oi-btn-secondary"
              onClick={onOpenFile}
              title={WORKBENCH_STRINGS.openFileTooltip}
            >
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
              <span>{WORKBENCH_STRINGS.openFile}</span>
            </button>
            <button
              type="button"
              className="oi-btn oi-btn-secondary"
              onClick={onOpenFolder}
              title={WORKBENCH_STRINGS.openFolderTooltip}
            >
              <FontAwesomeIcon icon={faFolderOpen} aria-hidden="true" />
              <span>{WORKBENCH_STRINGS.openFolder}</span>
            </button>
            <button
              type="button"
              className="oi-btn oi-btn-primary"
              onClick={onSave}
              disabled={!canSave}
              title={WORKBENCH_STRINGS.saveTooltip}
            >
              <FontAwesomeIcon icon={faFloppyDisk} aria-hidden="true" />
              <span>{WORKBENCH_STRINGS.save}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
