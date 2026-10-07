import { DisposableStore, onUnexpectedError } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import type { ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faDownload,
  faFileLines,
  faFloppyDisk,
  faFolderOpen,
  faGlobe,
  faMagnifyingGlass,
  faMoon,
  faPen,
  faPlus,
  faSpinner,
  faSun,
  faTrashCan,
} from '@fortawesome/free-solid-svg-icons';
import type {
  IPythonServiceClient,
  IPythonStatus,
  ISearchProgress,
  IToolchainServiceClient,
  IToolchainStatus,
  ToolchainCandidateSource,
} from '@oi/platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_TAB_SIZE_OPTIONS,
  type IEditorSettings,
} from './editorSettings';
import { WORKBENCH_STRINGS } from './strings';
import { TemplateContentEditor } from './templateContentEditor';
import { createTemplateId, type IFileTemplate } from './templates';

export interface ISettingsViewProps {
  readonly theme: ThemeKind;
  readonly canSave: boolean;
  readonly hidden?: boolean;
  readonly onToggleTheme: () => void;
  readonly editorSettings: IEditorSettings;
  readonly onEditorSettingsChange: (settings: IEditorSettings) => void;
  readonly languageService: ILanguageService;
  readonly onOpenFile: () => void;
  readonly onOpenFolder: () => void;
  readonly onSave: () => void;
  readonly toolchainService: IToolchainServiceClient;
  readonly pythonService: IPythonServiceClient;
  readonly templates: readonly IFileTemplate[];
  readonly onTemplatesChange: (templates: readonly IFileTemplate[]) => void;
}

const PIP_LOG_LIMIT = 200;

/** 候选来源徽标文案。 */
const CANDIDATE_SOURCE_LABELS: Record<ToolchainCandidateSource, string> = {
  path: WORKBENCH_STRINGS.settingsSourcePath,
  msys2: WORKBENCH_STRINGS.settingsSourceMsys2,
  mingw: WORKBENCH_STRINGS.settingsSourceMinGW,
  global: WORKBENCH_STRINGS.settingsSourceGlobal,
};

function progressText(progress: ISearchProgress): string {
  const detail = progress.detail ?? '';
  if (progress.phase === 'probing') {
    return WORKBENCH_STRINGS.settingsProbing.replace('{target}', detail);
  }
  if (detail.length > 0) {
    return WORKBENCH_STRINGS.settingsScanning.replace('{target}', detail);
  }
  return WORKBENCH_STRINGS.settingsSearching;
}

/**
 * 设置页：外观、文件操作、C++ 编译器、Python 解释器与 pip 安装。
 * 搜索/安装均为异步动作，搜索期间展示旋转动画与探测进度。
 */
export function SettingsView({
  theme,
  canSave,
  hidden,
  onToggleTheme,
  editorSettings,
  onEditorSettingsChange,
  languageService,
  onOpenFile,
  onOpenFolder,
  onSave,
  toolchainService,
  pythonService,
  templates,
  onTemplatesChange,
}: ISettingsViewProps) {
  const [cppStatus, setCppStatus] = useState<IToolchainStatus | undefined>(undefined);
  const [cppSearching, setCppSearching] = useState(false);
  const [cppForcing, setCppForcing] = useState(false);
  const [cppSwitching, setCppSwitching] = useState(false);
  const [cppProgress, setCppProgress] = useState<ISearchProgress | undefined>(undefined);
  const [cppFlags, setCppFlags] = useState('');
  const [flagsSaved, setFlagsSaved] = useState(false);
  const flagsInitializedRef = useRef(false);
  const [pythonStatus, setPythonStatus] = useState<IPythonStatus | undefined>(undefined);
  const [pythonSearching, setPythonSearching] = useState(false);
  const [pythonForcing, setPythonForcing] = useState(false);
  const [pythonProgress, setPythonProgress] = useState<ISearchProgress | undefined>(undefined);
  const [packageName, setPackageName] = useState('');
  const [packageVersion, setPackageVersion] = useState('');
  const [useTsinghua, setUseTsinghua] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [pipLog, setPipLog] = useState<string[]>([]);
  const [pipMessage, setPipMessage] = useState<string | undefined>(undefined);
  const [templateDraft, setTemplateDraft] = useState<IFileTemplate | undefined>(undefined);

  useEffect(() => {
    const store = new DisposableStore();
    store.add(
      toolchainService.onDidSearchProgress((progress) => {
        if (progress.phase !== 'finished') {
          setCppProgress(progress);
        }
      }),
    );
    store.add(
      pythonService.onDidSearchProgress((progress) => {
        if (progress.phase !== 'finished') {
          setPythonProgress(progress);
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
    setCppProgress(undefined);
    try {
      setCppStatus(await toolchainService.search());
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setCppSearching(false);
      setCppProgress(undefined);
    }
  }, [toolchainService]);

  const forceSearchCpp = useCallback(async (): Promise<void> => {
    setCppForcing(true);
    setCppProgress(undefined);
    try {
      setCppStatus(await toolchainService.forceSearch());
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setCppForcing(false);
      setCppProgress(undefined);
    }
  }, [toolchainService]);

  const selectCompiler = useCallback(
    async (path: string): Promise<void> => {
      setCppSwitching(true);
      try {
        setCppStatus(await toolchainService.setDefaultCompiler(path));
      } catch (error) {
        onUnexpectedError(error);
      } finally {
        setCppSwitching(false);
      }
    },
    [toolchainService],
  );

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

  // 首次拿到状态时回填自定义编译选项，之后不覆盖用户编辑
  useEffect(() => {
    if (!flagsInitializedRef.current && cppStatus !== undefined) {
      flagsInitializedRef.current = true;
      setCppFlags(cppStatus.customFlags ?? '');
    }
  }, [cppStatus]);

  const saveCppFlags = useCallback(async (): Promise<void> => {
    try {
      await toolchainService.setCustomFlags(cppFlags);
      setCppStatus((previous) =>
        previous === undefined ? previous : { ...previous, customFlags: cppFlags.trim() },
      );
      setFlagsSaved(true);
    } catch (error) {
      onUnexpectedError(error);
    }
  }, [cppFlags, toolchainService]);

  const searchPython = useCallback(async (): Promise<void> => {
    setPythonSearching(true);
    setPythonProgress(undefined);
    try {
      setPythonStatus(await pythonService.search());
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setPythonSearching(false);
      setPythonProgress(undefined);
    }
  }, [pythonService]);

  const forceSearchPython = useCallback(async (): Promise<void> => {
    setPythonForcing(true);
    setPythonProgress(undefined);
    try {
      setPythonStatus(await pythonService.forceSearch());
    } catch (error) {
      onUnexpectedError(error);
    } finally {
      setPythonForcing(false);
      setPythonProgress(undefined);
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

  const commitTemplate = useCallback((): void => {
    if (templateDraft === undefined) {
      return;
    }
    const name = templateDraft.name.trim().length > 0 ? templateDraft.name.trim() : '未命名模板';
    const extension = templateDraft.extension.trim().replace(/^\.+/, '');
    const normalized: IFileTemplate = { ...templateDraft, name, extension };
    const exists = templates.some((template) => template.id === normalized.id);
    onTemplatesChange(
      exists
        ? templates.map((template) => (template.id === normalized.id ? normalized : template))
        : [...templates, normalized],
    );
    setTemplateDraft(undefined);
  }, [onTemplatesChange, templateDraft, templates]);

  const deleteTemplate = useCallback(
    (id: string): void => {
      onTemplatesChange(templates.filter((template) => template.id !== id));
      setTemplateDraft((draft) => (draft?.id === id ? undefined : draft));
    },
    [onTemplatesChange, templates],
  );

  const themeToggleText =
    theme === 'dark' ? WORKBENCH_STRINGS.themeToLight : WORKBENCH_STRINGS.themeToDark;
  const defaultInterpreter = pythonStatus?.interpreters.find(
    (interpreter) => interpreter.path === pythonStatus.defaultPath,
  );
  const cppBusy = cppSearching || cppForcing || cppSwitching;
  const pythonBusy = pythonSearching || pythonForcing;
  const cppCandidates = cppStatus?.candidates ?? [];

  return (
    <div className="oi-settings" hidden={hidden}>
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
          <div className="oi-settings-rows">
            <div className="oi-settings-row">
              <label className="oi-settings-label" htmlFor="oi-editor-font-size">
                {WORKBENCH_STRINGS.settingsEditorFontSize}
              </label>
              <input
                id="oi-editor-font-size"
                className="oi-input oi-editor-font-size"
                type="number"
                min={EDITOR_FONT_SIZE_MIN}
                max={EDITOR_FONT_SIZE_MAX}
                step={1}
                value={editorSettings.fontSize}
                onChange={(event) =>
                  onEditorSettingsChange({
                    ...editorSettings,
                    fontSize: Number.parseInt(event.target.value, 10),
                  })
                }
              />
            </div>
            <div className="oi-settings-row">
              <label className="oi-settings-label" htmlFor="oi-editor-tab-size">
                {WORKBENCH_STRINGS.settingsEditorTabSize}
              </label>
              <select
                id="oi-editor-tab-size"
                className="oi-select oi-editor-tab-size"
                value={editorSettings.tabSize}
                onChange={(event) =>
                  onEditorSettingsChange({
                    ...editorSettings,
                    tabSize: Number.parseInt(event.target.value, 10),
                  })
                }
              >
                {EDITOR_TAB_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {WORKBENCH_STRINGS.settingsEditorTabSizeUnit.replace('{size}', String(size))}
                  </option>
                ))}
              </select>
            </div>
          </div>
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

        <section className="oi-settings-section" aria-label={WORKBENCH_STRINGS.templates}>
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.templates}</h2>
          <p className="oi-settings-hint">{WORKBENCH_STRINGS.templatesHint}</p>
          {templates.length === 0 ? (
            <p className="oi-settings-hint oi-templates-empty">
              {WORKBENCH_STRINGS.templatesEmpty}
            </p>
          ) : (
            <div className="oi-template-list">
              {templates.map((template) => (
                <div key={template.id} className="oi-template-row">
                  <span className="oi-template-name">{template.name}</span>
                  <span className="oi-template-ext">
                    {template.extension.length > 0 ? `.${template.extension}` : '—'}
                  </span>
                  <button
                    type="button"
                    className="oi-btn oi-btn-icon oi-btn-secondary oi-template-edit"
                    onClick={() => setTemplateDraft({ ...template })}
                    title={`${WORKBENCH_STRINGS.templateEdit}：${template.name}`}
                    aria-label={`${WORKBENCH_STRINGS.templateEdit}：${template.name}`}
                  >
                    <FontAwesomeIcon icon={faPen} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="oi-btn oi-btn-icon oi-btn-secondary oi-template-delete"
                    onClick={() => deleteTemplate(template.id)}
                    title={`${WORKBENCH_STRINGS.templateDelete}：${template.name}`}
                    aria-label={`${WORKBENCH_STRINGS.templateDelete}：${template.name}`}
                  >
                    <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="oi-settings-actions">
            <button
              type="button"
              className="oi-btn oi-btn-secondary oi-template-add"
              onClick={() =>
                setTemplateDraft({
                  id: createTemplateId(),
                  name: '',
                  extension: 'cpp',
                  content: '',
                })
              }
            >
              <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
              <span>{WORKBENCH_STRINGS.templateAdd}</span>
            </button>
          </div>
          {templateDraft !== undefined ? (
            <div className="oi-template-editor">
              <label className="oi-field">
                <span className="oi-settings-label">{WORKBENCH_STRINGS.templateName}</span>
                <input
                  className="oi-input oi-template-name-input"
                  type="text"
                  value={templateDraft.name}
                  onChange={(event) =>
                    setTemplateDraft({ ...templateDraft, name: event.target.value })
                  }
                />
              </label>
              <label className="oi-field">
                <span className="oi-settings-label">{WORKBENCH_STRINGS.templateExtension}</span>
                <input
                  className="oi-input oi-template-ext-input"
                  type="text"
                  value={templateDraft.extension}
                  onChange={(event) =>
                    setTemplateDraft({ ...templateDraft, extension: event.target.value })
                  }
                />
              </label>
              <div className="oi-field">
                <span className="oi-settings-label">{WORKBENCH_STRINGS.templateContent}</span>
                <TemplateContentEditor
                  languageService={languageService}
                  extension={templateDraft.extension}
                  content={templateDraft.content}
                  fontSize={editorSettings.fontSize}
                  tabSize={editorSettings.tabSize}
                  onChange={(content) =>
                    setTemplateDraft((draft) =>
                      draft === undefined ? draft : { ...draft, content },
                    )
                  }
                />
              </div>
              <div className="oi-settings-actions">
                <button
                  type="button"
                  className="oi-btn oi-btn-primary oi-template-save"
                  onClick={commitTemplate}
                >
                  <span>{WORKBENCH_STRINGS.templateSave}</span>
                </button>
                <button
                  type="button"
                  className="oi-btn oi-btn-secondary"
                  onClick={() => setTemplateDraft(undefined)}
                >
                  <span>{WORKBENCH_STRINGS.templateCancel}</span>
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="oi-settings-section" aria-label={WORKBENCH_STRINGS.settingsToolchain}>
          <h2 className="oi-settings-section-title">{WORKBENCH_STRINGS.settingsToolchain}</h2>
          <p className="oi-settings-hint">{WORKBENCH_STRINGS.settingsToolchainHint}</p>
          <div className="oi-settings-actions">
            <button
              type="button"
              className="oi-btn oi-btn-secondary oi-cpp-search"
              onClick={() => void searchCpp()}
              disabled={cppBusy}
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
            <button
              type="button"
              className="oi-btn oi-btn-secondary oi-cpp-force-search"
              onClick={() => void forceSearchCpp()}
              disabled={cppBusy}
              title={WORKBENCH_STRINGS.settingsCppForceSearchHint}
            >
              <FontAwesomeIcon
                icon={cppForcing ? faSpinner : faGlobe}
                spin={cppForcing}
                aria-hidden="true"
              />
              <span>
                {cppForcing
                  ? WORKBENCH_STRINGS.settingsSearching
                  : WORKBENCH_STRINGS.settingsForceSearch}
              </span>
            </button>
            {cppBusy && cppProgress !== undefined ? (
              <span className="oi-search-progress" title={progressText(cppProgress)}>
                {progressText(cppProgress)}
              </span>
            ) : null}
          </div>
          <p className="oi-settings-hint oi-force-search-hint">
            {WORKBENCH_STRINGS.settingsCppForceSearchHint}
          </p>
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
                  disabled={cppBusy}
                >
                  {[...cppStatus.supportedStandards].reverse().map((standard) => (
                    <option key={standard} value={standard}>
                      {standard}
                    </option>
                  ))}
                </select>
              </div>
              {cppCandidates.length > 0 ? (
                <div className="oi-candidates-block">
                  <span className="oi-settings-label">
                    {WORKBENCH_STRINGS.settingsCppCandidates}
                  </span>
                  <div className="oi-cpp-candidates">
                    {cppCandidates.map((candidate) => {
                      const active = candidate.path === cppStatus.compilerPath;
                      return (
                        <button
                          key={candidate.path}
                          type="button"
                          className={`oi-radio-row oi-cpp-candidate${active ? ' oi-radio-row-active' : ''}`}
                          onClick={() => void selectCompiler(candidate.path)}
                          disabled={cppBusy}
                          title={candidate.path}
                        >
                          <FontAwesomeIcon
                            icon={faCircleCheck}
                            className="oi-radio-icon"
                            aria-hidden="true"
                          />
                          <span className="oi-python-version">{candidate.version}</span>
                          <span className="oi-python-path">{candidate.path}</span>
                          <span className="oi-candidate-source">
                            {CANDIDATE_SOURCE_LABELS[candidate.source]}
                          </span>
                          {active ? (
                            <span className="oi-radio-badge">
                              {WORKBENCH_STRINGS.settingsPythonDefault}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="oi-settings-row oi-settings-flags">
                <label className="oi-settings-label" htmlFor="oi-cpp-flags">
                  {WORKBENCH_STRINGS.settingsCppFlags}
                </label>
                <input
                  id="oi-cpp-flags"
                  className="oi-input oi-flags-input"
                  type="text"
                  value={cppFlags}
                  placeholder={WORKBENCH_STRINGS.settingsCppFlagsPlaceholder}
                  onChange={(event) => {
                    setCppFlags(event.target.value);
                    setFlagsSaved(false);
                  }}
                  disabled={cppBusy}
                />
                <button
                  type="button"
                  className="oi-btn oi-btn-secondary oi-flags-save"
                  onClick={() => void saveCppFlags()}
                  disabled={cppBusy}
                >
                  <span>{WORKBENCH_STRINGS.settingsSave}</span>
                </button>
              </div>
              {flagsSaved ? (
                <p className="oi-settings-hint oi-flags-saved">
                  {WORKBENCH_STRINGS.settingsFlagsSaved}
                </p>
              ) : null}
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
              disabled={pythonBusy}
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
            <button
              type="button"
              className="oi-btn oi-btn-secondary oi-python-force-search"
              onClick={() => void forceSearchPython()}
              disabled={pythonBusy}
              title={WORKBENCH_STRINGS.settingsPythonForceSearchHint}
            >
              <FontAwesomeIcon
                icon={pythonForcing ? faSpinner : faGlobe}
                spin={pythonForcing}
                aria-hidden="true"
              />
              <span>
                {pythonForcing
                  ? WORKBENCH_STRINGS.settingsSearching
                  : WORKBENCH_STRINGS.settingsForceSearch}
              </span>
            </button>
            {pythonBusy && pythonProgress !== undefined ? (
              <span className="oi-search-progress" title={progressText(pythonProgress)}>
                {progressText(pythonProgress)}
              </span>
            ) : null}
          </div>
          <p className="oi-settings-hint oi-force-search-hint">
            {WORKBENCH_STRINGS.settingsPythonForceSearchHint}
          </p>
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
