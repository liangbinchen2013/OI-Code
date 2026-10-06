import { DisposableStore, onUnexpectedError } from '@oi/base';
import type { ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faDownload,
  faFileLines,
  faFloppyDisk,
  faFolderOpen,
  faMagnifyingGlass,
  faMoon,
  faSpinner,
  faSun,
} from '@fortawesome/free-solid-svg-icons';
import type {
  IPythonServiceClient,
  IPythonStatus,
  IToolchainServiceClient,
  IToolchainStatus,
} from '@oi/platform';
import { useCallback, useEffect, useState } from 'react';
import { WORKBENCH_STRINGS } from './strings';

export interface ISettingsViewProps {
  readonly theme: ThemeKind;
  readonly canSave: boolean;
  readonly onToggleTheme: () => void;
  readonly onOpenFile: () => void;
  readonly onOpenFolder: () => void;
  readonly onSave: () => void;
  readonly toolchainService: IToolchainServiceClient;
  readonly pythonService: IPythonServiceClient;
}

const PIP_LOG_LIMIT = 200;

/**
 * 设置页：外观、文件操作、C++ 编译器、Python 解释器与 pip 安装。
 * 搜索/安装均为异步动作，搜索期间展示旋转动画与探测进度。
 */
export function SettingsView({
  theme,
  canSave,
  onToggleTheme,
  onOpenFile,
  onOpenFolder,
  onSave,
  toolchainService,
  pythonService,
}: ISettingsViewProps) {
  const [cppStatus, setCppStatus] = useState<IToolchainStatus | undefined>(undefined);
  const [cppSearching, setCppSearching] = useState(false);
  const [cppProgress, setCppProgress] = useState('');
  const [pythonStatus, setPythonStatus] = useState<IPythonStatus | undefined>(undefined);
  const [pythonSearching, setPythonSearching] = useState(false);
  const [pythonProgress, setPythonProgress] = useState('');
  const [packageName, setPackageName] = useState('');
  const [packageVersion, setPackageVersion] = useState('');
  const [useTsinghua, setUseTsinghua] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [pipLog, setPipLog] = useState<string[]>([]);
  const [pipMessage, setPipMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const store = new DisposableStore();
    store.add(
      toolchainService.onDidSearchProgress((progress) => {
        if (progress.phase === 'probing') {
          setCppProgress(progress.detail ?? '');
        }
      }),
    );
    store.add(
      pythonService.onDidSearchProgress((progress) => {
        if (progress.phase === 'probing') {
          setPythonProgress(progress.detail ?? '');
        }
      }),
    );
    store.add(
      pythonService.onDidPipOutput((chunk) => {
        setPipLog((previous) => [...previous.slice(-(PIP_LOG_LIMIT - 1)), chunk.chunk]);
      }),
    );
    void toolchainService.getStatus().then(setCppStatus, onUnexpectedError);
    void pythonService.getStatus().then(setPythonStatus, onUnexpectedError);
    return () => store.dispose();
  }, [pythonService, toolchainService]);

  const searchCpp = useCallback(async (): Promise<void> => {
    setCppSearching(true);
    setCppProgress('');
    try {
      setCppStatus(await toolchainService.search());
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setCppSearching(false);
      setCppProgress('');
    }
  }, [toolchainService]);

  const changeStandard = useCallback(
    async (standard: string): Promise<void> => {
      try {
        await toolchainService.setDefaultStandard(standard);
        setCppStatus((previous) =>
          previous === undefined ? previous : { ...previous, defaultStandard: standard },
        );
      } catch (error) {
        onUnexpectedError(error);
      }
    },
    [toolchainService],
  );

  const searchPython = useCallback(async (): Promise<void> => {
    setPythonSearching(true);
    setPythonProgress('');
    try {
      setPythonStatus(await pythonService.search());
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setPythonSearching(false);
      setPythonProgress('');
    }
  }, [pythonService]);

  const selectInterpreter = useCallback(
    async (path: string): Promise<void> => {
      try {
        await pythonService.setDefaultInterpreter(path);
        setPythonStatus((previous) =>
          previous === undefined ? previous : { ...previous, defaultPath: path },
        );
      } catch (error) {
        onUnexpectedError(error);
      }
    },
    [pythonService],
  );

  const install = useCallback(async (): Promise<void> => {
    setInstalling(true);
    setPipMessage(undefined);
    setPipLog([]);
    try {
      const result = await pythonService.pipInstall({
        packageName: packageName.trim(),
        ...(packageVersion.trim().length > 0 ? { version: packageVersion.trim() } : {}),
        useTsinghuaMirror: useTsinghua,
      });
      setPipMessage(result.message);
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setInstalling(false);
    }
  }, [packageName, packageVersion, pythonService, useTsinghua]);

  const themeToggleText =
    theme === 'dark' ? WORKBENCH_STRINGS.themeToLight : WORKBENCH_STRINGS.themeToDark;
  const defaultInterpreter = pythonStatus?.interpreters.find(
    (interpreter) => interpreter.path === pythonStatus.defaultPath,
  );

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

        <section className="oi-settings-section" aria-label={WORKBENCH_STRINGS.settingsToolchain}>
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.settingsToolchain}</h2>
          <p className="oi-settings-hint">{WORKBENCH_STRINGS.settingsToolchainHint}</p>
          <div className="oi-settings-actions">
            <button
              type="button"
              className="oi-btn oi-btn-secondary oi-cpp-search"
              onClick={() => void searchCpp()}
              disabled={cppSearching}
            >
              <FontAwesomeIcon
                icon={cppSearching ? faSpinner : faMagnifyingGlass}
                spin={cppSearching}
                aria-hidden="true"
              />
              <span>
                {cppSearching
                  ? WORKBENCH_STRINGS.settingsSearching
                  : cppStatus?.found === true
                    ? WORKBENCH_STRINGS.settingsResearch
                    : WORKBENCH_STRINGS.settingsSearch}
              </span>
            </button>
            {cppSearching && cppProgress.length > 0 ? (
              <span className="oi-search-progress">
                {WORKBENCH_STRINGS.settingsProbing.replace('{target}', cppProgress)}
              </span>
            ) : null}
          </div>
          {cppStatus?.found === true ? (
            <div className="oi-settings-rows">
              <div className="oi-settings-row">
                <span className="oi-settings-label">{WORKBENCH_STRINGS.settingsCppVersion}</span>
                <span>{cppStatus.compilerVersion}</span>
              </div>
              <div className="oi-settings-row">
                <span className="oi-settings-label">{WORKBENCH_STRINGS.settingsCppPath}</span>
                <code className="oi-settings-code">{cppStatus.compilerPath}</code>
              </div>
              <div className="oi-settings-row">
                <span className="oi-settings-label">{WORKBENCH_STRINGS.settingsCppStandards}</span>
                <span className="oi-chip-list">
                  {cppStatus.supportedStandards.map((standard) => (
                    <span key={standard} className="oi-chip">
                      {standard}
                    </span>
                  ))}
                </span>
              </div>
              <div className="oi-settings-row">
                <label className="oi-settings-label" htmlFor="oi-cpp-standard">
                  {WORKBENCH_STRINGS.settingsCppDefaultStandard}
                </label>
                <select
                  id="oi-cpp-standard"
                  className="oi-select"
                  value={cppStatus.defaultStandard ?? ''}
                  onChange={(event) => void changeStandard(event.target.value)}
                  disabled={cppSearching}
                >
                  {[...cppStatus.supportedStandards].reverse().map((standard) => (
                    <option key={standard} value={standard}>
                      {standard}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <p className="oi-settings-hint oi-cpp-not-found">
              {WORKBENCH_STRINGS.settingsCppNotFound}
            </p>
          )}
        </section>

        <section className="oi-settings-section" aria-label={WORKBENCH_STRINGS.settingsPython}>
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.settingsPython}</h2>
          <p className="oi-settings-hint">{WORKBENCH_STRINGS.settingsPythonHint}</p>
          <div className="oi-settings-actions">
            <button
              type="button"
              className="oi-btn oi-btn-secondary oi-python-search"
              onClick={() => void searchPython()}
              disabled={pythonSearching}
            >
              <FontAwesomeIcon
                icon={pythonSearching ? faSpinner : faMagnifyingGlass}
                spin={pythonSearching}
                aria-hidden="true"
              />
              <span>
                {pythonSearching
                  ? WORKBENCH_STRINGS.settingsSearching
                  : pythonStatus !== undefined && pythonStatus.interpreters.length > 0
                    ? WORKBENCH_STRINGS.settingsResearch
                    : WORKBENCH_STRINGS.settingsSearch}
              </span>
            </button>
            {pythonSearching && pythonProgress.length > 0 ? (
              <span className="oi-search-progress">
                {WORKBENCH_STRINGS.settingsProbing.replace('{target}', pythonProgress)}
              </span>
            ) : null}
          </div>
          {pythonStatus !== undefined && pythonStatus.interpreters.length > 0 ? (
            <div className="oi-python-list">
              {pythonStatus.interpreters.map((interpreter) => {
                const active = interpreter.path === pythonStatus.defaultPath;
                return (
                  <button
                    key={interpreter.path}
                    type="button"
                    className={`oi-radio-row${active ? ' oi-radio-row-active' : ''}`}
                    onClick={() => void selectInterpreter(interpreter.path)}
                  >
                    <FontAwesomeIcon
                      icon={faCircleCheck}
                      className="oi-radio-icon"
                      aria-hidden="true"
                    />
                    <span className="oi-python-version">{interpreter.versionText}</span>
                    <span className="oi-python-path">{interpreter.path}</span>
                    {active ? (
                      <span className="oi-radio-badge">
                        {WORKBENCH_STRINGS.settingsPythonDefault}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="oi-settings-hint oi-python-not-found">
              {WORKBENCH_STRINGS.settingsPythonNotFound}
            </p>
          )}
        </section>

        <section className="oi-settings-section" aria-label={WORKBENCH_STRINGS.settingsPip}>
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.settingsPip}</h2>
          <p className="oi-settings-hint">
            {WORKBENCH_STRINGS.settingsPipTarget}
            {defaultInterpreter === undefined ? '—' : defaultInterpreter.versionText}
          </p>
          <div className="oi-pip-form">
            <label className="oi-field">
              <span className="oi-settings-label">{WORKBENCH_STRINGS.settingsPipPackage}</span>
              <input
                className="oi-input"
                type="text"
                value={packageName}
                placeholder={WORKBENCH_STRINGS.settingsPipPackagePlaceholder}
                onChange={(event) => setPackageName(event.target.value)}
                disabled={installing}
              />
            </label>
            <label className="oi-field">
              <span className="oi-settings-label">{WORKBENCH_STRINGS.settingsPipVersion}</span>
              <input
                className="oi-input"
                type="text"
                value={packageVersion}
                placeholder={WORKBENCH_STRINGS.settingsPipVersionPlaceholder}
                onChange={(event) => setPackageVersion(event.target.value)}
                disabled={installing}
              />
            </label>
            <label className="oi-checkbox-row">
              <input
                type="checkbox"
                checked={useTsinghua}
                onChange={(event) => setUseTsinghua(event.target.checked)}
                disabled={installing}
              />
              <span>{WORKBENCH_STRINGS.settingsPipTsinghua}</span>
            </label>
            <button
              type="button"
              className="oi-btn oi-btn-primary oi-pip-install"
              onClick={() => void install()}
              disabled={installing || packageName.trim().length === 0}
            >
              <FontAwesomeIcon
                icon={installing ? faSpinner : faDownload}
                spin={installing}
                aria-hidden="true"
              />
              <span>
                {installing
                  ? WORKBENCH_STRINGS.settingsPipInstalling
                  : WORKBENCH_STRINGS.settingsPipInstall}
              </span>
            </button>
          </div>
          {pipMessage !== undefined ? <p className="oi-settings-hint">{pipMessage}</p> : null}
          {pipLog.length > 0 ? (
            <pre className="oi-log" aria-label={WORKBENCH_STRINGS.settingsPipLog}>
              {pipLog.join('')}
            </pre>
          ) : null}
        </section>
      </div>
    </div>
  );
}
