import { DisposableStore, onUnexpectedError, toDisposable, type IDisposable } from '@oi/base';
import { URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import { getFileExtension } from '@oi/editor';
import type { IEditorMarker, ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleInfo,
  faCircleXmark,
  faDownload,
  faFileLines,
  faFolderOpen,
  faGear,
  faPlay,
  faRotateLeft,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type {
  IAutoSaveDraft,
  IAutoSaveServiceClient,
  ICodeDiagnostic,
  IFileDialogService,
  IFileService,
  IJudgeServiceClient,
  IPreloadEnvironment,
  IPythonServiceClient,
  ISearchProgress,
  IToolchainServiceClient,
  IVjudgeServiceClient,
} from '@oi/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityBar, type ActivityView } from './activityBar';
import { EditorPane, type IEditorPaneHandle } from './editorPane';
import {
  normalizeEditorSettings,
  persistEditorSettings,
  readEditorSettings,
  type IEditorSettings,
} from './editorSettings';
import {
  detectLanguageFromContent,
  suggestFileName,
  type DetectedLanguage,
} from './languageDetection';
import {
  downloadLinksOf,
  hasRunEnvironmentBootstrap,
  markEnvironmentBootstrapDone,
  runEnvironmentBootstrap,
  type EnvironmentLanguage,
  type IEnvironmentProgress,
  type IEnvironmentState,
  type ISearchRound,
} from './environmentBootstrap';
import {
  clampSidebarWidth,
  clampSplitRatio,
  isCollapsedWidth,
  persistSidebarWidth,
  persistSplit,
  readStoredLastExpandedWidth,
  readStoredSidebarWidth,
  readStoredSplit,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_COLLAPSE_SNAP,
  type SplitDirection,
} from './layout';
import type { IJudgeSource } from './judgeTool';
import { ToolboxPanel } from './oiToolbox';
import { isPreviewableName, PreviewPanel } from './previewPanel';
import { ProblemsPanel, type IProblemItem } from './problemsPanel';
import { SettingsView } from './settingsView';
import { ExplorerPanel } from './sidebar';
import { WORKBENCH_STRINGS } from './strings';
import { TabBar } from './tabBar';
import { VjudgePanel } from './vjudgePanel';
import {
  BUILT_IN_TEMPLATE_IDS,
  PLAIN_TEMPLATE,
  loadTemplateStore,
  mergeTemplateStore,
  resolveDefaultTemplate,
  saveTemplateStore,
  templateStoreFromList,
  type IFileTemplate,
  type ITemplateStore,
} from './templates';
import { applyTheme, persistTheme, readStoredTheme, resolveInitialTheme } from './theme';
// KaTeX 样式必须先于工作台样式，后者的覆盖规则才有机会生效
import 'katex/dist/katex.min.css';
import './tokens.css';
import './workbench.css';

/**
 * 工作台依赖的服务集合，由 Code 层装配后注入。
 */
export interface IWorkbenchServices {
  readonly fileService: IFileService;
  readonly fileDialogService: IFileDialogService;
  readonly languageService: ILanguageService;
  readonly toolchainService: IToolchainServiceClient;
  readonly pythonService: IPythonServiceClient;
  readonly autoSaveService: IAutoSaveServiceClient;
  readonly judgeService: IJudgeServiceClient;
  readonly vjudgeService: IVjudgeServiceClient;
}

export interface IWorkbenchOptions {
  readonly container: HTMLElement;
  /** 主进程下发的环境策略（缺省视为开发模式，不自动全盘扫描）。 */
  readonly environment?: IPreloadEnvironment;
  readonly services: IWorkbenchServices;
  /** 脏状态上报（主进程据此拦截关闭），由 Code 层提供。 */
  readonly onDirtyStateChange?: (dirty: boolean) => void;
}

type WorkbenchStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'saveFailed'
  | 'openFailed'
  | 'compiling'
  | 'compileOk'
  | 'compileFailed'
  | 'checkOk'
  | 'checkFailed'
  | 'runLaunched'
  | 'runFailed'
  | 'unsupported'
  | 'needSave'
  | 'envReady'
  | 'envMissing'
  | 'envFailed';
type BusyAction = 'compile' | 'run' | undefined;
type SourceLanguage = 'cpp' | 'python';

interface ITabState {
  readonly id: string;
  readonly uri: URI;
  readonly name: string;
  readonly untitled: boolean;
  readonly dirty: boolean;
}

const STATUS_AUTO_HIDE_MS = 3000;
/** 输入停止后多久触发实时语法检查。 */
const LIVE_CHECK_DEBOUNCE_MS = 700;
/** 无扩展名文档停止输入后多久重做一次语言识别（避免每次按键都全量扫正文）。 */
const DETECT_DEBOUNCE_MS = 300;
/** 静默自动保存触发间隔（毫秒）。 */
const AUTOSAVE_INTERVAL_MS = 10_000;

// 进行中的状态不自动隐藏，完成后由新状态替换
const STICKY_STATUSES: ReadonlySet<WorkbenchStatus> = new Set(['saving', 'compiling']);

const STATUS_PRESENTATION: Record<
  Exclude<WorkbenchStatus, 'idle'>,
  { readonly icon: IconDefinition; readonly text: string }
> = {
  saving: { icon: faSpinner, text: WORKBENCH_STRINGS.saving },
  saved: { icon: faCircleCheck, text: WORKBENCH_STRINGS.saved },
  saveFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.saveFailed },
  openFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.openFailed },
  compiling: { icon: faSpinner, text: WORKBENCH_STRINGS.compiling },
  compileOk: { icon: faCircleCheck, text: WORKBENCH_STRINGS.compileOk },
  compileFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.compileFailed },
  checkOk: { icon: faCircleCheck, text: WORKBENCH_STRINGS.checkOk },
  checkFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.checkFailed },
  runLaunched: { icon: faPlay, text: WORKBENCH_STRINGS.runLaunched },
  runFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.runFailed },
  unsupported: { icon: faCircleInfo, text: WORKBENCH_STRINGS.unsupported },
  needSave: { icon: faCircleInfo, text: WORKBENCH_STRINGS.needSave },
  envReady: { icon: faCircleCheck, text: WORKBENCH_STRINGS.envStatusReady },
  envMissing: { icon: faCircleInfo, text: WORKBENCH_STRINGS.envStatusPartial },
  envFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.envStatusFailed },
};

function fileNameOf(uri: URI): string {
  const name = uri.path.split('/').pop();
  return name !== undefined && name.length > 0 ? name : uri.path;
}

function draftDisplayName(uri: string): string {
  try {
    return fileNameOf(URI.parse(uri));
  } catch {
    return uri;
  }
}

/** 无法识别语言时的补充说明：无扩展名提示补后缀。 */
function unsupportedLanguageDetail(tab: ITabState): string | undefined {
  return getFileExtension(tab.name) === undefined ? WORKBENCH_STRINGS.needExtension : undefined;
}

function toEditorMarkers(diagnostics: readonly ICodeDiagnostic[]): IEditorMarker[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
    ...(diagnostic.endLine === undefined ? {} : { endLine: diagnostic.endLine }),
    ...(diagnostic.endColumn === undefined ? {} : { endColumn: diagnostic.endColumn }),
  }));
}

/** 自检进度文案：按「语言 + 是否全盘扫描」选择提示语。 */
const ENV_PROGRESS_TEXTS: Record<`${EnvironmentLanguage}-${'force' | 'simple'}`, string> = {
  'cpp-force': WORKBENCH_STRINGS.envForceScanningCpp,
  'cpp-simple': WORKBENCH_STRINGS.envCheckingCpp,
  'python-force': WORKBENCH_STRINGS.envForceScanningPython,
  'python-simple': WORKBENCH_STRINGS.envCheckingPython,
};

function envProgressText(progress: IEnvironmentProgress): string {
  return ENV_PROGRESS_TEXTS[`${progress.language}-${progress.force ? 'force' : 'simple'}`];
}

function envDetailOfLanguage(language: EnvironmentLanguage, state: IEnvironmentState): string {
  const result = language === 'cpp' ? state.cpp : state.python;
  if (!result.found) {
    return WORKBENCH_STRINGS.envMissing;
  }
  return result.version === undefined
    ? WORKBENCH_STRINGS.envFoundPlain
    : WORKBENCH_STRINGS.envFound.replace('{version}', result.version);
}

interface IWorkbenchProps {
  readonly environment: IPreloadEnvironment;
  readonly services: IWorkbenchServices;
  readonly initialTheme: ThemeKind;
  readonly onDirtyStateChange?: (dirty: boolean) => void;
}

function Workbench({ environment, services, initialTheme, onDirtyStateChange }: IWorkbenchProps) {
  const [store] = useState(() => new DisposableStore());
  const [tabs, setTabs] = useState<ITabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined);
  const [rootUri, setRootUri] = useState<URI | undefined>(undefined);
  const [treeVersion, setTreeVersion] = useState(0);
  const [activityView, setActivityView] = useState<ActivityView>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredSidebarWidth());
  const [lastExpandedWidth, setLastExpandedWidth] = useState(() => readStoredLastExpandedWidth());
  const [templateStore, setTemplateStore] = useState<ITemplateStore>(() => loadTemplateStore());
  const [editorSettings, setEditorSettings] = useState(() => readEditorSettings());
  const [split, setSplit] = useState(() => readStoredSplit());
  const [splitTabId, setSplitTabId] = useState<string | undefined>(undefined);
  const [focusedPane, setFocusedPane] = useState<'primary' | 'secondary'>('primary');
  const [contentVersion, setContentVersion] = useState(0);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitEditorPaneRef = useRef<IEditorPaneHandle | null>(null);
  const splitTabIdRef = useRef<string | undefined>(undefined);
  const splitModeRef = useRef<'preview' | 'editor' | 'none'>('none');
  const previousActiveTabIdRef = useRef<string | undefined>(undefined);
  const focusedPaneRef = useRef<'primary' | 'secondary'>('primary');
  const editingTabRef = useRef<ITabState | undefined>(undefined);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const lastExpandedWidthRef = useRef(lastExpandedWidth);
  const [theme, setTheme] = useState<ThemeKind>(initialTheme);
  const [status, setStatus] = useState<WorkbenchStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<BusyAction>(undefined);
  const [problems, setProblems] = useState<IProblemItem[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<readonly IAutoSaveDraft[]>([]);
  const [envProgress, setEnvProgress] = useState<IEnvironmentProgress | undefined>(undefined);
  const [envResult, setEnvResult] = useState<IEnvironmentState | undefined>(undefined);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const lastAutoSavedRef = useRef(new Map<string, string>());
  const editorPaneRef = useRef<IEditorPaneHandle | null>(null);
  const tabsRef = useRef<ITabState[]>([]);
  const activeTabIdRef = useRef<string | undefined>(undefined);
  const nextUntitledRef = useRef(1);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const busyRef = useRef(false);
  const problemsRef = useRef(new Map<string, IProblemItem[]>());
  const checkTokensRef = useRef(new Map<string, number>());
  const checkTimersRef = useRef(new Map<string, IDisposable>());
  /** 无扩展名文档的识别结论（按 URI 存，定型后保持，避免边写边跳）。 */
  const detectedRef = useRef(new Map<string, DetectedLanguage>());
  const detectTimersRef = useRef(new Map<string, IDisposable>());
  const openFileRef = useRef<() => Promise<void>>(async () => undefined);
  const openFolderRef = useRef<() => Promise<void>>(async () => undefined);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const compileRef = useRef<() => Promise<void>>(async () => undefined);
  const compileRunRef = useRef<() => Promise<void>>(async () => undefined);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
  const scheduleCheckRef = useRef<(tab: ITabState, delayMs: number) => void>(() => undefined);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    lastExpandedWidthRef.current = lastExpandedWidth;
  }, [lastExpandedWidth]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 窗口缩小时同步收缩侧边栏，保证编辑器最小宽度
  useEffect(() => {
    const onResize = (): void => {
      setSidebarWidth((current) => clampSidebarWidth(current, window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    store.add(toDisposable(() => window.removeEventListener('resize', onResize)));
  }, [store]);

  // 用户未显式选择过主题时，跟随系统亮暗变化
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => {
      if (readStoredTheme() === undefined) {
        setTheme(media.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener('change', listener);
    store.add(toDisposable(() => media.removeEventListener('change', listener)));
  }, [store]);

  // 启动时扫描崩溃/断电留下的草稿
  useEffect(() => {
    let cancelled = false;
    services.autoSaveService.scanDrafts().then(
      (drafts) => {
        if (!cancelled && drafts.length > 0) {
          setPendingDrafts(drafts);
        }
      },
      (error: unknown) => onUnexpectedError(error),
    );
    return () => {
      cancelled = true;
    };
  }, [services.autoSaveService]);

  // 首次启动自动配置编译环境：缓存已配置则静默跳过，一次性标记保证只跑一遍
  useEffect(() => {
    if (environment.skipBootstrap || hasRunEnvironmentBootstrap()) {
      return undefined;
    }
    let cancelled = false;
    let round: ISearchRound | undefined;
    // 搜索进度经服务的通知事件上报（RPC 客户端不消费调用级回调），需按当前轮归属展示
    const showProgress = (progress: ISearchProgress): void => {
      if (cancelled || round === undefined || progress.phase === 'finished') {
        return;
      }
      setEnvProgress({
        force: round.force,
        language: round.language,
        ...(progress.detail === undefined ? {} : { detail: progress.detail }),
      });
    };
    const subscriptions = new DisposableStore();
    subscriptions.add(services.toolchainService.onDidSearchProgress(showProgress));
    subscriptions.add(services.pythonService.onDidSearchProgress(showProgress));
    void runEnvironmentBootstrap({
      allowForceSearch: environment.allowAutoForceSearch,
      onRoundStart: (started): void => {
        round = started;
      },
      services: {
        pythonService: services.pythonService,
        toolchainService: services.toolchainService,
      },
    }).then(
      (state) => {
        subscriptions.dispose();
        if (cancelled) {
          return;
        }
        markEnvironmentBootstrapDone();
        setEnvProgress(undefined);
        setEnvResult(state);
        const missing: string[] = [];
        if (!state.cpp.found) {
          missing.push(WORKBENCH_STRINGS.envStatusCppMissing);
        }
        if (!state.python.found) {
          missing.push(WORKBENCH_STRINGS.envStatusPythonMissing);
        }
        if (missing.length > 0) {
          setEnvDialogOpen(true);
          setStatus('envMissing');
          setStatusDetail(missing.join(WORKBENCH_STRINGS.listSeparator));
        } else {
          setStatus('envReady');
          setStatusDetail(WORKBENCH_STRINGS.envFoundHint);
        }
      },
      (error: unknown) => {
        subscriptions.dispose();
        if (cancelled) {
          return;
        }
        onUnexpectedError(error);
        setEnvProgress(undefined);
        setStatus('envFailed');
        setStatusDetail(undefined);
      },
    );
    return () => {
      cancelled = true;
      subscriptions.dispose();
    };
  }, [environment, services.pythonService, services.toolchainService]);

  // 定时静默保存脏文档；内容与上次落盘一致时跳过
  useEffect(() => {
    const timer = window.setInterval(() => {
      const editor = editorPaneRef.current;
      if (!editor) {
        return;
      }
      for (const document of editor.getDirtyDocuments()) {
        const key = document.uri.toString();
        if (lastAutoSavedRef.current.get(key) === document.content) {
          continue;
        }
        void services.autoSaveService.saveDraft(key, document.content).then(
          () => lastAutoSavedRef.current.set(key, document.content),
          (error: unknown) => onUnexpectedError(error),
        );
      }
    }, AUTOSAVE_INTERVAL_MS);
    store.add(toDisposable(() => window.clearInterval(timer)));
  }, [services.autoSaveService, store]);

  // 任一标签页存在未保存修改即视为脏
  const anyDirty = tabs.some((tab) => tab.dirty);
  useEffect(() => {
    onDirtyStateChange?.(anyDirty);
  }, [anyDirty, onDirtyStateChange]);

  // 结果胶囊几秒后自动消失；进行中状态常驻
  useEffect(() => {
    if (status === 'idle' || STICKY_STATUSES.has(status)) {
      return undefined;
    }
    const timer = window.setTimeout(() => setStatus('idle'), STATUS_AUTO_HIDE_MS);
    const handle = toDisposable(() => window.clearTimeout(timer));
    store.add(handle);
    return () => {
      store.delete(handle);
      handle.dispose();
    };
  }, [status, store]);

  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  const toggleTheme = useCallback(() => {
    const next: ThemeKind = theme === 'dark' ? 'light' : 'dark';
    persistTheme(next);
    setTheme(next);
  }, [theme]);

  const updateEditorSettings = useCallback((next: IEditorSettings): void => {
    const normalized = normalizeEditorSettings(next);
    setEditorSettings(normalized);
    persistEditorSettings(normalized);
  }, []);

  // Ctrl+滚轮：按增量调整字号并持久化
  const adjustFontSize = useCallback((delta: number): void => {
    setEditorSettings((current) => {
      const next = normalizeEditorSettings({
        ...current,
        fontSize: current.fontSize + delta,
      });
      if (next.fontSize === current.fontSize) {
        return current;
      }
      persistEditorSettings(next);
      return next;
    });
  }, []);

  // + 菜单使用的模板列表：内置模板可覆盖/隐藏，后接自定义模板
  const templates = useMemo(() => mergeTemplateStore(templateStore), [templateStore]);

  const updateTemplates = useCallback(
    (next: readonly IFileTemplate[]): void => {
      const store = templateStoreFromList(next, templateStore.defaultTemplateId);
      setTemplateStore(store);
      saveTemplateStore(store);
    },
    [templateStore.defaultTemplateId],
  );

  const changeDefaultTemplate = useCallback((id: string): void => {
    setTemplateStore((current) => {
      const store: ITemplateStore = { ...current, defaultTemplateId: id };
      saveTemplateStore(store);
      return store;
    });
  }, []);

  /** 恢复内置模板默认内容并取消隐藏；保留用户新增模板。 */
  const resetBuiltInTemplates = useCallback((): void => {
    const store: ITemplateStore = {
      custom: templateStore.custom.filter((template) => !BUILT_IN_TEMPLATE_IDS.has(template.id)),
      hidden: [],
    };
    setTemplateStore(store);
    saveTemplateStore(store);
  }, [templateStore.custom]);

  /** 当前焦点所在的分屏目标；未开启双编辑器时恒为左屏。 */
  const focusedPaneTarget = useCallback(
    (): 'primary' | 'secondary' =>
      focusedPaneRef.current === 'secondary' && splitModeRef.current === 'editor'
        ? 'secondary'
        : 'primary',
    [],
  );

  /**
   * 点击标签：在焦点所在分屏打开。点击的文件若正在另一屏，
   * 则两屏内容交换，保证点击结果出现在焦点侧。
   */
  const activateTab = useCallback((id: string): void => {
    const currentActive = activeTabIdRef.current;
    const currentSplit = splitTabIdRef.current;
    if (focusedPaneRef.current === 'secondary' && splitModeRef.current === 'editor') {
      if (id === currentSplit) {
        return;
      }
      previousActiveTabIdRef.current = currentActive;
      setSplitTabId(id);
      if (id === currentActive) {
        setActiveTabId(currentSplit);
        const leftTab = tabsRef.current.find((tab) => tab.id === currentSplit);
        if (leftTab !== undefined) {
          editorPaneRef.current?.setActiveDocument(leftTab.uri);
        }
      }
      return;
    }
    setFocusedPane('primary');
    if (id === currentActive) {
      return;
    }
    previousActiveTabIdRef.current = currentActive;
    setActiveTabId(id);
    if (id === currentSplit) {
      setSplitTabId(currentActive);
    }
    const tab = tabsRef.current.find((candidate) => candidate.id === id);
    if (tab) {
      editorPaneRef.current?.setActiveDocument(tab.uri);
    }
  }, []);

  /**
   * 无扩展名文档：按内容识别语言并应用到编辑器高亮。
   * 置信度不足时保持上一次结论（可能仍是 plaintext），等用户继续写再判。
   */
  const detectLanguageFor = useCallback((tab: ITabState, text: string): void => {
    if (getFileExtension(tab.name) !== undefined) {
      return;
    }
    const key = tab.uri.toString();
    const detected = detectLanguageFromContent(text);
    if (detected === undefined || detectedRef.current.get(key) === detected) {
      return;
    }
    detectedRef.current.set(key, detected);
    editorPaneRef.current?.setLanguage(tab.uri, detected);
  }, []);

  const scheduleDetect = useCallback(
    (tab: ITabState): void => {
      if (getFileExtension(tab.name) !== undefined) {
        return;
      }
      const key = tab.uri.toString();
      const existing = detectTimersRef.current.get(key);
      if (existing !== undefined) {
        store.delete(existing);
        existing.dispose();
        detectTimersRef.current.delete(key);
      }
      const timer = window.setTimeout(() => {
        const entry = detectTimersRef.current.get(key);
        if (entry !== undefined) {
          store.delete(entry);
          entry.dispose();
          detectTimersRef.current.delete(key);
        }
        const text = editorPaneRef.current?.getValue(tab.uri);
        if (text !== undefined) {
          detectLanguageFor(tab, text);
        }
      }, DETECT_DEBOUNCE_MS);
      const handle = toDisposable(() => window.clearTimeout(timer));
      store.add(handle);
      detectTimersRef.current.set(key, handle);
    },
    [detectLanguageFor, store],
  );

  /** 保存无扩展名文档时按识别结果补上建议后缀，避免用户漏写。 */
  const suggestedSaveName = useCallback((tab: ITabState): string => {
    if (getFileExtension(tab.name) !== undefined) {
      return tab.name;
    }
    return suggestFileName(tab.name, detectedRef.current.get(tab.uri.toString()));
  }, []);

  const openUri = useCallback(
    async (uri: URI, targetPane: 'primary' | 'secondary' = 'primary'): Promise<void> => {
      const key = uri.toString();
      const toSecondary = targetPane === 'secondary' && splitModeRef.current === 'editor';
      const existing = tabsRef.current.find((tab) => tab.uri.toString() === key);
      if (existing) {
        // 已打开：由 activateTab 按焦点侧决定显示/交换
        activateTab(existing.id);
        return;
      }
      try {
        const text = await services.fileService.readFile(uri);
        const tab: ITabState = {
          id: key,
          uri,
          name: fileNameOf(uri),
          untitled: false,
          dirty: false,
        };
        if (toSecondary) {
          // 仅注册到主编辑器（共享模型），显示交给副编辑器
          editorPaneRef.current?.ensureDocument(uri, text);
          detectLanguageFor(tab, text);
          setTabs((previous) => [...previous, tab]);
          setSplitTabId(tab.id);
        } else {
          editorPaneRef.current?.openDocument(uri, text);
          detectLanguageFor(tab, text);
          setTabs((previous) => [...previous, tab]);
          setActiveTabId(tab.id);
        }
        setStatus('idle');
        scheduleCheckRef.current(tab, 0);
      } catch (error) {
        setStatus('openFailed');
        onUnexpectedError(error);
      }
    },
    [activateTab, detectLanguageFor, services.fileService],
  );

  const openFile = useCallback(async (): Promise<void> => {
    const uri = await services.fileDialogService.showOpenFile({
      title: WORKBENCH_STRINGS.openFile,
    });
    if (uri) {
      const target = focusedPaneTarget();
      await openUri(uri, target);
      if (target === 'primary') {
        editorPaneRef.current?.focus();
      }
    }
  }, [focusedPaneTarget, openUri, services.fileDialogService]);

  const openFolder = useCallback(async (): Promise<void> => {
    const uri = await services.fileDialogService.showOpenFolder({
      title: WORKBENCH_STRINGS.openFolder,
    });
    if (uri) {
      setRootUri(uri);
      setTreeVersion((version) => version + 1);
    }
  }, [services.fileDialogService]);

  const createFromTemplate = useCallback(
    (template: IFileTemplate): void => {
      const index = nextUntitledRef.current++;
      const extension = template.extension.trim().replace(/^\./, '');
      const base = `${WORKBENCH_STRINGS.untitledPrefix}-${index}`;
      const name = extension.length > 0 ? `${base}.${extension}` : base;
      const uri = URI.from({ scheme: 'untitled', path: `/${name}` });
      const tab: ITabState = { id: uri.toString(), uri, name, untitled: true, dirty: false };
      if (focusedPaneTarget() === 'secondary') {
        // 焦点在右屏：注册到主编辑器（共享模型），由副编辑器显示
        editorPaneRef.current?.ensureDocument(uri, template.content);
        detectLanguageFor(tab, template.content);
        setTabs((previous) => [...previous, tab]);
        setSplitTabId(tab.id);
      } else {
        editorPaneRef.current?.openDocument(uri, template.content);
        detectLanguageFor(tab, template.content);
        setTabs((previous) => [...previous, tab]);
        setActiveTabId(tab.id);
      }
      setNewMenuOpen(false);
    },
    [detectLanguageFor, focusedPaneTarget],
  );

  // + 菜单固定项：无后缀空文件
  const createUntitledFile = useCallback((): void => {
    createFromTemplate(PLAIN_TEMPLATE);
  }, [createFromTemplate]);

  const newDefaultFile = useCallback((): void => {
    createFromTemplate(resolveDefaultTemplate(templates, templateStore.defaultTemplateId));
  }, [createFromTemplate, templates, templateStore.defaultTemplateId]);

  const clearAutoSaveDraft = useCallback(
    (uri: URI): void => {
      lastAutoSavedRef.current.delete(uri.toString());
      void services.autoSaveService.clearDraft(uri.toString()).catch(onUnexpectedError);
    },
    [services.autoSaveService],
  );

  /** 恢复全部待处理草稿：内容回填编辑器并重建为脏标签页。 */
  const recoverDrafts = useCallback((): void => {
    const drafts = pendingDrafts;
    setPendingDrafts([]);
    const editor = editorPaneRef.current;
    if (editor === null || drafts.length === 0) {
      return;
    }
    const recovered = new Map<string, ITabState>();
    for (const draft of drafts) {
      const uri = URI.parse(draft.uri);
      const id = uri.toString();
      editor.openDocument(uri, draft.content);
      lastAutoSavedRef.current.set(id, draft.content);
      recovered.set(id, {
        id,
        uri,
        name: fileNameOf(uri),
        untitled: uri.scheme !== 'file',
        dirty: true,
      });
    }
    setTabs((previous) => {
      const existing = new Set(previous.map((tab) => tab.id));
      const merged = previous.map((tab) => (recovered.has(tab.id) ? { ...tab, dirty: true } : tab));
      for (const [id, tab] of recovered) {
        if (!existing.has(id)) {
          merged.push(tab);
        }
      }
      return merged;
    });
    const first = drafts[0];
    if (first !== undefined) {
      const id = URI.parse(first.uri).toString();
      setActiveTabId(id);
      editor.setActiveDocument(URI.parse(first.uri));
    }
  }, [pendingDrafts]);

  /** 放弃恢复：删除全部待处理草稿。 */
  const dismissDrafts = useCallback((): void => {
    const drafts = pendingDrafts;
    setPendingDrafts([]);
    for (const draft of drafts) {
      lastAutoSavedRef.current.delete(draft.uri);
      void services.autoSaveService.clearDraft(draft.uri).catch(onUnexpectedError);
    }
  }, [pendingDrafts, services.autoSaveService]);

  const closeTab = useCallback(
    async (id: string): Promise<void> => {
      const tab = tabsRef.current.find((candidate) => candidate.id === id);
      if (!tab) {
        return;
      }
      if (tab.dirty) {
        const confirmed = await services.fileDialogService.confirmDiscardChanges(tab.name);
        if (!confirmed) {
          return;
        }
      }
      editorPaneRef.current?.closeDocument(tab.uri);
      splitEditorPaneRef.current?.closeDocument(tab.uri);
      clearAutoSaveDraft(tab.uri);
      const pendingTimer = checkTimersRef.current.get(tab.id);
      if (pendingTimer !== undefined) {
        store.delete(pendingTimer);
        pendingTimer.dispose();
        checkTimersRef.current.delete(tab.id);
      }
      // 令在途的实时检查结果失效
      checkTokensRef.current.set(tab.id, (checkTokensRef.current.get(tab.id) ?? 0) + 1);
      const detectTimer = detectTimersRef.current.get(tab.uri.toString());
      if (detectTimer !== undefined) {
        store.delete(detectTimer);
        detectTimer.dispose();
        detectTimersRef.current.delete(tab.uri.toString());
      }
      detectedRef.current.delete(tab.uri.toString());
      const remaining = tabsRef.current.filter((candidate) => candidate.id !== id);
      setTabs(remaining);
      if (activeTabIdRef.current === id) {
        const index = tabsRef.current.findIndex((candidate) => candidate.id === id);
        const next = remaining[Math.min(index, remaining.length - 1)];
        setActiveTabId(next?.id);
        editorPaneRef.current?.setActiveDocument(next?.uri);
      }
    },
    [clearAutoSaveDraft, services.fileDialogService],
  );

  const handleContentChange = useCallback(
    (uri: URI): void => {
      const key = uri.toString();
      setTabs((previous) =>
        previous.map((tab) => (tab.uri.toString() === key ? { ...tab, dirty: true } : tab)),
      );
      setContentVersion((version) => version + 1);
      setStatus('idle');
      const tab = tabsRef.current.find((candidate) => candidate.uri.toString() === key);
      if (tab !== undefined) {
        scheduleCheckRef.current(tab, LIVE_CHECK_DEBOUNCE_MS);
        scheduleDetect(tab);
      }
    },
    [scheduleDetect],
  );

  const save = useCallback(
    async function saveLoop(): Promise<void> {
      // 分屏时保存焦点所在编辑器的文档；单编辑器即当前标签
      const tab = editingTabRef.current;
      const editor =
        focusedPaneRef.current === 'secondary' ? splitEditorPaneRef.current : editorPaneRef.current;
      if (!tab || !editor) {
        return;
      }
      if (savingRef.current) {
        // 连续 Ctrl+S 时合并为一次补写，保证最终内容落盘
        saveQueuedRef.current = true;
        return;
      }
      savingRef.current = true;
      setStatus('saving');
      try {
        if (tab.untitled) {
          const target = await services.fileDialogService.showSaveFile({
            title: WORKBENCH_STRINGS.saveAs,
            // 按内容识别结果建议后缀，用户只需确认文件名
            defaultPath: suggestedSaveName(tab),
          });
          if (!target) {
            setStatus('idle');
            editor.focus();
            return;
          }
          detectedRef.current.delete(tab.uri.toString());
          const text = editor.getValue(tab.uri);
          await services.fileService.writeFile(target, text);
          editor.replaceDocument(tab.uri, target, text);
          // 另一分屏若同样打开该文档，需要同步换绑新 URI
          const otherPane =
            editor === editorPaneRef.current ? splitEditorPaneRef.current : editorPaneRef.current;
          otherPane?.replaceDocument(tab.uri, target, text);
          clearAutoSaveDraft(tab.uri);
          const updated: ITabState = {
            id: target.toString(),
            uri: target,
            name: fileNameOf(target),
            untitled: false,
            dirty: false,
          };
          setTabs((previous) =>
            previous.map((candidate) => (candidate.id === tab.id ? updated : candidate)),
          );
          setActiveTabId(updated.id);
          const groups = new Map(problemsRef.current);
          groups.delete(tab.id);
          problemsRef.current = groups;
          setProblems([...groups.values()].flat());
          scheduleCheckRef.current(updated, 0);
        } else {
          await services.fileService.writeFile(tab.uri, editor.getValue(tab.uri));
          editor.markSaved(tab.uri);
          clearAutoSaveDraft(tab.uri);
          setTabs((previous) =>
            previous.map((candidate) =>
              candidate.id === tab.id ? { ...candidate, dirty: false } : candidate,
            ),
          );
        }
        setStatus('saved');
      } catch (error) {
        setStatus('saveFailed');
        onUnexpectedError(error);
      } finally {
        savingRef.current = false;
        if (saveQueuedRef.current) {
          saveQueuedRef.current = false;
          void saveLoop();
        }
      }
    },
    [clearAutoSaveDraft, services.fileDialogService, services.fileService, suggestedSaveName],
  );

  const groupProblems = useCallback(
    (sourceUri: URI, sourceName: string, diagnostics: readonly ICodeDiagnostic[]) => {
      const groups = new Map<string, IProblemItem[]>();
      for (const diagnostic of diagnostics) {
        const uri = diagnostic.uri ?? sourceUri;
        const key = uri.toString();
        const item: IProblemItem = {
          uri,
          fileName: diagnostic.fileName ?? sourceName,
          line: diagnostic.line,
          column: diagnostic.column,
          severity: diagnostic.severity,
          message: diagnostic.message,
        };
        const bucket = groups.get(key);
        if (bucket === undefined) {
          groups.set(key, [item]);
        } else {
          bucket.push(item);
        }
      }
      return groups;
    },
    [],
  );

  const replaceProblems = useCallback((groups: ReadonlyMap<string, IProblemItem[]>): void => {
    problemsRef.current = new Map(groups);
    setProblems([...groups.values()].flat());
  }, []);

  const setProblemsForFile = useCallback(
    (key: string, items: readonly IProblemItem[]): void => {
      const groups = new Map(problemsRef.current);
      if (items.length === 0) {
        groups.delete(key);
      } else {
        groups.set(key, [...items]);
      }
      replaceProblems(groups);
    },
    [replaceProblems],
  );

  const languageOf = useCallback(
    (tab: ITabState): SourceLanguage | undefined => {
      const extension = getFileExtension(tab.name);
      const languageId =
        services.languageService.getLanguageByFileName(tab.name) ??
        (extension === undefined
          ? undefined
          : services.languageService.getLanguageByExtension(extension));
      if (languageId === 'cpp' || languageId === 'python') {
        return languageId;
      }
      // 无扩展名时按内容识别，已定型的结论优先；只有可运行语言才参与编译运行
      if (extension === undefined) {
        const detected =
          detectedRef.current.get(tab.uri.toString()) ??
          detectLanguageFromContent(editorPaneRef.current?.getValue(tab.uri) ?? '');
        return detected === 'cpp' || detected === 'python' ? detected : undefined;
      }
      return undefined;
    },
    [services.languageService],
  );

  /** 取当前焦点编辑器里可评测的源（C++ / Python）。 */
  const resolveJudgeSource = useCallback((): IJudgeSource | undefined => {
    const tab = editingTabRef.current;
    if (tab === undefined) {
      return undefined;
    }
    const language = languageOf(tab);
    if (language === undefined) {
      return undefined;
    }
    return {
      name: tab.name,
      content: editorPaneRef.current?.getValue(tab.uri) ?? '',
      language,
    };
  }, [languageOf]);

  const runTab = useCallback(
    async (tab: ITabState, language: SourceLanguage): Promise<void> => {
      setBusy('run');
      try {
        const result =
          language === 'cpp'
            ? await services.toolchainService.run(tab.uri)
            : await services.pythonService.run(tab.uri);
        if (result.launched) {
          setStatus('runLaunched');
          setStatusDetail(undefined);
        } else {
          setStatus('runFailed');
          setStatusDetail(result.message);
        }
      } catch (error) {
        setStatus('runFailed');
        setStatusDetail(undefined);
        onUnexpectedError(error);
      } finally {
        setBusy(undefined);
      }
    },
    [services.pythonService, services.toolchainService],
  );

  const compileActive = useCallback(
    async (andRun: boolean): Promise<void> => {
      // 编译目标随焦点：分屏时以焦点编辑器所在标签为准
      const tab = editingTabRef.current;
      const editor = editorPaneRef.current;
      if (!tab || !editor || busyRef.current) {
        return;
      }
      if (tab.untitled) {
        setStatus('needSave');
        setStatusDetail(undefined);
        return;
      }
      const language = languageOf(tab);
      if (language === undefined) {
        setStatus('unsupported');
        setStatusDetail(unsupportedLanguageDetail(tab));
        return;
      }
      const content = editor.getValue(tab.uri);
      busyRef.current = true;
      setBusy('compile');
      setStatus('compiling');
      setStatusDetail(undefined);
      try {
        if (language === 'python') {
          const diagnostics = await services.pythonService.check(tab.uri, content);
          editor.setMarkers(tab.uri, toEditorMarkers(diagnostics));
          replaceProblems(
            diagnostics.length === 0 ? new Map() : groupProblems(tab.uri, tab.name, diagnostics),
          );
          if (diagnostics.length > 0) {
            setProblemsOpen(true);
          }
          setStatus(diagnostics.length === 0 ? 'checkOk' : 'checkFailed');
          setStatusDetail(diagnostics.length === 0 ? undefined : `${diagnostics.length} 处问题`);
          if (andRun) {
            await runTab(tab, language);
          }
        } else {
          const result = await services.toolchainService.compile({ uri: tab.uri, content });
          editor.setMarkers(tab.uri, toEditorMarkers(result.diagnostics));
          replaceProblems(groupProblems(tab.uri, tab.name, result.diagnostics));
          if (!result.ok && result.diagnostics.length > 0) {
            setProblemsOpen(true);
          }
          setStatus(result.ok ? 'compileOk' : 'compileFailed');
          setStatusDetail(
            result.ok
              ? `${result.durationMs}ms`
              : result.diagnostics.length > 0
                ? `${result.diagnostics.length} 处问题`
                : result.message,
          );
          if (result.ok && andRun) {
            await runTab(tab, language);
          }
        }
      } catch (error) {
        setStatus('compileFailed');
        setStatusDetail(undefined);
        onUnexpectedError(error);
      } finally {
        busyRef.current = false;
        setBusy(undefined);
      }
    },
    [
      groupProblems,
      languageOf,
      replaceProblems,
      runTab,
      services.pythonService,
      services.toolchainService,
    ],
  );

  /**
   * 实时语法检查单个文档：内容变化防抖后调用，结果随令牌过期丢弃。
   */
  const performCheck = useCallback(
    async (tab: ITabState): Promise<void> => {
      const editor = editorPaneRef.current;
      if (!editor || tab.untitled) {
        return;
      }
      const language = languageOf(tab);
      if (language === undefined) {
        return;
      }
      const key = tab.uri.toString();
      const token = (checkTokensRef.current.get(key) ?? 0) + 1;
      checkTokensRef.current.set(key, token);
      try {
        const content = editor.getValue(tab.uri);
        const diagnostics =
          language === 'cpp'
            ? await services.toolchainService.check(tab.uri, content)
            : await services.pythonService.check(tab.uri, content);
        // 输入期间会有多次检查在途，只采纳最后一次的结果
        if (checkTokensRef.current.get(key) !== token) {
          return;
        }
        editor.setMarkers(tab.uri, toEditorMarkers(diagnostics));
        const sourceDiagnostics = diagnostics.filter(
          (diagnostic) => diagnostic.uri === undefined || diagnostic.uri.toString() === key,
        );
        setProblemsForFile(
          key,
          sourceDiagnostics.map((diagnostic) => ({
            uri: diagnostic.uri ?? tab.uri,
            fileName: diagnostic.fileName ?? tab.name,
            line: diagnostic.line,
            column: diagnostic.column,
            severity: diagnostic.severity,
            message: diagnostic.message,
          })),
        );
      } catch (error) {
        onUnexpectedError(error);
      }
    },
    [languageOf, services.pythonService, services.toolchainService, setProblemsForFile],
  );

  const scheduleCheck = useCallback(
    (tab: ITabState, delayMs: number): void => {
      const key = tab.uri.toString();
      const existing = checkTimersRef.current.get(key);
      if (existing !== undefined) {
        store.delete(existing);
        existing.dispose();
        checkTimersRef.current.delete(key);
      }
      const timer = window.setTimeout(() => {
        const entry = checkTimersRef.current.get(key);
        if (entry !== undefined) {
          store.delete(entry);
          entry.dispose();
          checkTimersRef.current.delete(key);
        }
        void performCheck(tab);
      }, delayMs);
      const handle = toDisposable(() => window.clearTimeout(timer));
      store.add(handle);
      checkTimersRef.current.set(key, handle);
    },
    [performCheck, store],
  );

  const runActive = useCallback(async (): Promise<void> => {
    const tab = editingTabRef.current;
    if (!tab || busyRef.current) {
      return;
    }
    if (tab.untitled) {
      setStatus('needSave');
      setStatusDetail(undefined);
      return;
    }
    const language = languageOf(tab);
    if (language === undefined) {
      setStatus('unsupported');
      setStatusDetail(unsupportedLanguageDetail(tab));
      return;
    }
    busyRef.current = true;
    try {
      await runTab(tab, language);
    } finally {
      busyRef.current = false;
    }
  }, [languageOf, runTab]);

  const gotoProblem = useCallback(
    async (problem: IProblemItem): Promise<void> => {
      if (problem.uri === undefined) {
        return;
      }
      const target = focusedPaneTarget();
      const pane = target === 'secondary' ? splitEditorPaneRef.current : editorPaneRef.current;
      if (pane?.hasDocument(problem.uri) !== true) {
        await openUri(problem.uri, target);
      }
      const activePane =
        target === 'secondary' ? splitEditorPaneRef.current : editorPaneRef.current;
      activePane?.revealPosition(problem.uri, problem.line, problem.column);
    },
    [focusedPaneTarget, openUri],
  );

  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

  useEffect(() => {
    openFolderRef.current = openFolder;
  }, [openFolder]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    compileRef.current = () => compileActive(false);
  }, [compileActive]);

  useEffect(() => {
    compileRunRef.current = () => compileActive(true);
  }, [compileActive]);

  useEffect(() => {
    runRef.current = runActive;
  }, [runActive]);

  useEffect(() => {
    scheduleCheckRef.current = scheduleCheck;
  }, [scheduleCheck]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'F10') {
        event.preventDefault();
        void runRef.current();
        return;
      }
      if (event.key === 'F11') {
        event.preventDefault();
        void compileRunRef.current();
        return;
      }
      if (event.key === 'F12') {
        event.preventDefault();
        void compileRef.current();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void saveRef.current();
      } else if (key === 'o') {
        event.preventDefault();
        void openFileRef.current();
      } else if (key === 'n') {
        event.preventDefault();
        newDefaultFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    // 用 effect 清理而不是 DisposableStore：newDefaultFile 变化时旧监听必须移除，否则重复触发
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newDefaultFile]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const statusPresentation = status === 'idle' ? undefined : STATUS_PRESENTATION[status];
  const splitActive = split.direction !== null && activeTab !== undefined;
  const splitTab = tabs.find((tab) => tab.id === splitTabId);
  // 当前文件是 Markdown/HTML 时分屏为预览；否则若有第二标签则双编辑器并排
  const splitMode: 'preview' | 'editor' | 'none' =
    activeTab === undefined
      ? 'none'
      : isPreviewableName(activeTab.name)
        ? 'preview'
        : splitTab !== undefined
          ? 'editor'
          : 'preview';
  const editingTab = focusedPane === 'secondary' && splitMode === 'editor' ? splitTab : activeTab;
  // 标签高亮跟随焦点侧文档
  const highlightedTabId =
    focusedPane === 'secondary' && splitMode === 'editor' ? splitTabId : activeTabId;
  const previewDocument = useMemo(
    () =>
      activeTab === undefined
        ? undefined
        : {
            name: activeTab.name,
            content: editorPaneRef.current?.getValue(activeTab.uri) ?? '',
          },
    [activeTab, contentVersion],
  );

  useEffect(() => {
    focusedPaneRef.current = focusedPane;
  }, [focusedPane]);

  useEffect(() => {
    editingTabRef.current = editingTab;
  }, [editingTab]);

  useEffect(() => {
    splitTabIdRef.current = splitTabId;
  }, [splitTabId]);

  useEffect(() => {
    splitModeRef.current = splitMode;
  }, [splitMode]);

  // 保持副标签有效：当前标签或已关闭时切换到上一个标签
  useEffect(() => {
    if (!splitActive) {
      return;
    }
    if (
      splitTabId !== undefined &&
      splitTabId !== activeTabId &&
      tabs.some((tab) => tab.id === splitTabId)
    ) {
      return;
    }
    const previous = previousActiveTabIdRef.current;
    const candidate =
      previous !== undefined && previous !== activeTabId && tabs.some((tab) => tab.id === previous)
        ? previous
        : tabs.find((tab) => tab.id !== activeTabId)?.id;
    setSplitTabId(candidate);
  }, [activeTabId, splitActive, splitTabId, tabs]);

  const cycleSplit = useCallback((): void => {
    const direction: SplitDirection | null =
      split.direction === null
        ? 'horizontal'
        : split.direction === 'horizontal'
          ? 'vertical'
          : null;
    const next = { direction, ratio: split.ratio };
    setSplit(next);
    persistSplit(next);
  }, [split.direction, split.ratio]);

  const beginSplitResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const container = splitContainerRef.current;
      const direction = split.direction;
      if (container === null || direction === null) {
        return;
      }
      const rect = container.getBoundingClientRect();
      let latestRatio = split.ratio;
      const onMove = (moveEvent: PointerEvent): void => {
        const raw =
          direction === 'vertical'
            ? (moveEvent.clientY - rect.top) / rect.height
            : (moveEvent.clientX - rect.left) / rect.width;
        latestRatio = clampSplitRatio(raw);
        setSplit((current) => ({ ...current, ratio: latestRatio }));
      };
      const onUp = (): void => {
        removeMove.dispose();
        removeUp.dispose();
        store.delete(removeMove);
        store.delete(removeUp);
        persistSplit({ direction, ratio: latestRatio });
      };
      const removeMove = toDisposable(() => window.removeEventListener('pointermove', onMove));
      const removeUp = toDisposable(() => window.removeEventListener('pointerup', onUp));
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      store.add(removeMove);
      store.add(removeUp);
    },
    [split.direction, split.ratio, store],
  );

  const selectActivityView = useCallback(
    (view: ActivityView): void => {
      // 折叠态点击活动栏图标：展开至上次非折叠宽度并保持
      if (isCollapsedWidth(sidebarWidthRef.current)) {
        setSidebarWidth(clampSidebarWidth(lastExpandedWidthRef.current));
        setActivityView(view);
        return;
      }
      // 再次点击当前视图：快速折叠回活动栏
      if (view === activityView) {
        setSidebarWidth(SIDEBAR_COLLAPSED_WIDTH);
        persistSidebarWidth(SIDEBAR_COLLAPSED_WIDTH);
        return;
      }
      setActivityView(view);
    },
    [activityView],
  );

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidthRef.current;
      let latestWidth = startWidth;
      const onMove = (moveEvent: PointerEvent): void => {
        latestWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
        setSidebarWidth(latestWidth);
      };
      const onUp = (): void => {
        removeMove.dispose();
        removeUp.dispose();
        store.delete(removeMove);
        store.delete(removeUp);
        // 拖拽到折叠阈值内直接吸附为完全折叠
        const finalWidth =
          latestWidth < SIDEBAR_COLLAPSE_SNAP ? SIDEBAR_COLLAPSED_WIDTH : latestWidth;
        setSidebarWidth(finalWidth);
        if (isCollapsedWidth(finalWidth)) {
          persistSidebarWidth(finalWidth);
        } else {
          setLastExpandedWidth(finalWidth);
          persistSidebarWidth(finalWidth);
        }
      };
      const removeMove = toDisposable(() => window.removeEventListener('pointermove', onMove));
      const removeUp = toDisposable(() => window.removeEventListener('pointerup', onUp));
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      store.add(removeMove);
      store.add(removeUp);
    },
    [store],
  );

  const restoreSidebarWidth = useCallback((): void => {
    if (!isCollapsedWidth(sidebarWidthRef.current)) {
      return;
    }
    const restored = clampSidebarWidth(lastExpandedWidthRef.current);
    setLastExpandedWidth(restored);
    setSidebarWidth(restored);
    persistSidebarWidth(restored);
  }, []);

  return (
    <div className="oi-workbench">
      <TabBar
        tabs={tabs}
        activeTabId={highlightedTabId}
        onActivate={activateTab}
        onClose={(id) => void closeTab(id)}
        actionsEnabled={activeTab !== undefined}
        busy={busy !== undefined}
        problemCount={problems.length}
        problemsOpen={problemsOpen}
        onCompile={() => void compileRef.current()}
        onRun={() => void runRef.current()}
        onCompileRun={() => void compileRunRef.current()}
        onToggleProblems={() => setProblemsOpen((open) => !open)}
        splitDirection={split.direction}
        onCycleSplit={cycleSplit}
        templates={templates}
        newMenuOpen={newMenuOpen}
        onToggleNewMenu={() => setNewMenuOpen((open) => !open)}
        onCloseNewMenu={() => setNewMenuOpen(false)}
        onCreateUntitled={createUntitledFile}
        onCreateFromTemplate={createFromTemplate}
      />
      <div className="oi-body">
        <div className="oi-sidebar-region">
          <ActivityBar activeView={activityView} onSelect={selectActivityView} />
          <div
            className={`oi-sidebar${isCollapsedWidth(sidebarWidth) ? ' collapsed' : ''}`}
            style={{ width: sidebarWidth }}
          >
            <div className="oi-sidebar-panels">
              <ExplorerPanel
                rootUri={rootUri}
                treeVersion={treeVersion}
                fileService={services.fileService}
                hidden={activityView !== 'explorer'}
                onOpenFile={(uri) => void openUri(uri, focusedPaneTarget())}
                onOpenFolder={() => void openFolderRef.current()}
                onRefresh={() => setTreeVersion((version) => version + 1)}
              />
              <ToolboxPanel
                hidden={activityView !== 'toolbox'}
                appTheme={theme}
                judgeService={services.judgeService}
                fileDialogService={services.fileDialogService}
                resolveJudgeSource={resolveJudgeSource}
              />
              <VjudgePanel
                hidden={activityView !== 'vjudge'}
                appTheme={theme}
                resolveSource={resolveJudgeSource}
                vjudgeService={services.vjudgeService}
              />
              <SettingsView
                theme={theme}
                canSave={activeTab !== undefined}
                hidden={activityView !== 'settings'}
                onToggleTheme={toggleTheme}
                editorSettings={editorSettings}
                onEditorSettingsChange={updateEditorSettings}
                languageService={services.languageService}
                onOpenFile={() => void openFileRef.current()}
                onOpenFolder={() => void openFolderRef.current()}
                onSave={() => void saveRef.current()}
                toolchainService={services.toolchainService}
                pythonService={services.pythonService}
                templates={templates}
                builtInTemplateIds={[...BUILT_IN_TEMPLATE_IDS]}
                defaultTemplateId={
                  resolveDefaultTemplate(templates, templateStore.defaultTemplateId).id
                }
                onTemplatesChange={updateTemplates}
                onResetBuiltInTemplates={resetBuiltInTemplates}
                onDefaultTemplateChange={changeDefaultTemplate}
              />
            </div>
          </div>
          <div
            className="oi-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={WORKBENCH_STRINGS.resizeSidebar}
            title={WORKBENCH_STRINGS.resizeSidebar}
            onPointerDown={beginResize}
            onDoubleClick={restoreSidebarWidth}
          />
        </div>
        <main className="oi-main">
          <div
            ref={splitContainerRef}
            className={`oi-split${
              split.direction === null ? '' : ` oi-split-${split.direction}`
            }${splitActive ? ' oi-split-active' : ''}`}
          >
            <div
              className="oi-split-primary"
              style={
                splitActive
                  ? split.direction === 'vertical'
                    ? { height: `${split.ratio * 100}%` }
                    : { width: `${split.ratio * 100}%` }
                  : undefined
              }
            >
              <EditorPane
                ref={editorPaneRef}
                languageService={services.languageService}
                onDidChangeContent={handleContentChange}
                onSaveRequested={() => void saveRef.current()}
                onDidFocus={() => setFocusedPane('primary')}
                onAdjustFontSize={adjustFontSize}
                fontSize={editorSettings.fontSize}
                tabSize={editorSettings.tabSize}
              />
            </div>
            {splitActive ? (
              <>
                <div
                  className="oi-split-handle"
                  role="separator"
                  aria-orientation={split.direction === 'horizontal' ? 'vertical' : 'horizontal'}
                  aria-label={WORKBENCH_STRINGS.split}
                  onPointerDown={beginSplitResize}
                />
                <div className="oi-split-secondary">
                  {splitMode === 'editor' ? (
                    <EditorPane
                      ref={splitEditorPaneRef}
                      languageService={services.languageService}
                      onDidChangeContent={handleContentChange}
                      onSaveRequested={() => void saveRef.current()}
                      onDidFocus={() => setFocusedPane('secondary')}
                      onAdjustFontSize={adjustFontSize}
                      documentUri={splitTab?.uri}
                      documentText={
                        splitTab === undefined
                          ? undefined
                          : (editorPaneRef.current?.getValue(splitTab.uri) ?? '')
                      }
                      fontSize={editorSettings.fontSize}
                      tabSize={editorSettings.tabSize}
                    />
                  ) : (
                    <PreviewPanel document={previewDocument} theme={theme} />
                  )}
                </div>
              </>
            ) : null}
          </div>
          {tabs.length === 0 ? (
            <div className="oi-empty-state">
              <h1 className="oi-empty-title">{WORKBENCH_STRINGS.emptyTitle}</h1>
              <p className="oi-empty-hint">{WORKBENCH_STRINGS.emptyHint}</p>
              <div className="oi-empty-actions">
                <button
                  type="button"
                  className="oi-btn oi-btn-primary"
                  onClick={() => void openFileRef.current()}
                >
                  <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
                  <span>{WORKBENCH_STRINGS.openFile}</span>
                </button>
                <button
                  type="button"
                  className="oi-btn oi-btn-secondary"
                  onClick={() => void openFolderRef.current()}
                >
                  <FontAwesomeIcon icon={faFolderOpen} aria-hidden="true" />
                  <span>{WORKBENCH_STRINGS.openFolder}</span>
                </button>
              </div>
            </div>
          ) : null}
          {problemsOpen ? (
            <ProblemsPanel
              problems={problems}
              onSelect={(problem) => void gotoProblem(problem)}
              onClose={() => setProblemsOpen(false)}
            />
          ) : null}
          {statusPresentation ? (
            <div
              className={`oi-status-capsule oi-status-${status}`}
              role="status"
              aria-live="polite"
            >
              <FontAwesomeIcon
                icon={statusPresentation.icon}
                spin={status === 'saving' || status === 'compiling'}
                aria-hidden="true"
              />
              <span>{statusPresentation.text}</span>
              {statusDetail !== undefined ? (
                <span className="oi-status-detail">{statusDetail}</span>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
      {pendingDrafts.length > 0 ? (
        <div
          className="oi-recover-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={WORKBENCH_STRINGS.recoverTitle}
        >
          <div className="oi-recover-dialog">
            <h2 className="oi-recover-title">{WORKBENCH_STRINGS.recoverTitle}</h2>
            <p className="oi-recover-hint">
              {WORKBENCH_STRINGS.recoverHint.replace('{count}', String(pendingDrafts.length))}
            </p>
            <ul className="oi-recover-list">
              {pendingDrafts.map((draft) => (
                <li key={draft.uri}>{draftDisplayName(draft.uri)}</li>
              ))}
            </ul>
            <div className="oi-recover-actions">
              <button
                type="button"
                className="oi-btn oi-btn-primary oi-recover-confirm"
                onClick={recoverDrafts}
              >
                <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                <span>{WORKBENCH_STRINGS.recoverConfirm}</span>
              </button>
              <button
                type="button"
                className="oi-btn oi-btn-secondary oi-recover-dismiss"
                onClick={dismissDrafts}
              >
                <span>{WORKBENCH_STRINGS.recoverDismiss}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {envDialogOpen && envResult !== undefined ? (
        <div
          className="oi-recover-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={WORKBENCH_STRINGS.envMissingHint}
        >
          <div className="oi-recover-dialog oi-env-dialog">
            <h2 className="oi-recover-title">{WORKBENCH_STRINGS.envMissingHint}</h2>
            <ul className="oi-env-list">
              {(['cpp', 'python'] as const).map((language) => {
                const result = language === 'cpp' ? envResult.cpp : envResult.python;
                return (
                  <li key={language} className="oi-env-row">
                    <span className="oi-env-language">
                      {language === 'cpp'
                        ? WORKBENCH_STRINGS.envLanguageCpp
                        : WORKBENCH_STRINGS.envLanguagePython}
                    </span>
                    <span className={result.found ? 'oi-env-found' : 'oi-env-missing'}>
                      <FontAwesomeIcon
                        icon={result.found ? faCircleCheck : faCircleXmark}
                        aria-hidden="true"
                      />
                      <span>{envDetailOfLanguage(language, envResult)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {(['cpp', 'python'] as const)
              .filter((language) => !(language === 'cpp' ? envResult.cpp : envResult.python).found)
              .map((language) => (
                <div key={language} className="oi-env-links-block">
                  <p className="oi-env-heading">
                    {language === 'cpp'
                      ? WORKBENCH_STRINGS.envDownloadHeadingCpp
                      : WORKBENCH_STRINGS.envDownloadHeadingPython}
                  </p>
                  <ul className="oi-env-links">
                    {downloadLinksOf(language).map((link) => (
                      <li key={link.url}>
                        <a href={link.url} target="_blank" rel="noreferrer">
                          <FontAwesomeIcon icon={faDownload} aria-hidden="true" />
                          <span>{link.label}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            {!environment.allowAutoForceSearch ? (
              <p className="oi-env-note">{WORKBENCH_STRINGS.envDevForceNote}</p>
            ) : null}
            <p className="oi-env-note">{WORKBENCH_STRINGS.envSettingsNote}</p>
            <div className="oi-recover-actions">
              <button
                type="button"
                className="oi-btn oi-btn-primary oi-env-settings"
                onClick={() => {
                  setActivityView('settings');
                  setEnvDialogOpen(false);
                }}
              >
                <FontAwesomeIcon icon={faGear} aria-hidden="true" />
                <span>{WORKBENCH_STRINGS.envOpenSettings}</span>
              </button>
              <button
                type="button"
                className="oi-btn oi-btn-secondary oi-env-finish"
                onClick={() => setEnvDialogOpen(false)}
              >
                <span>{WORKBENCH_STRINGS.envFinish}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {envProgress !== undefined ? (
        <div
          className="oi-env-progress"
          role="status"
          aria-label={WORKBENCH_STRINGS.envCheckingTitle}
        >
          <FontAwesomeIcon icon={faSpinner} beat aria-hidden="true" />
          <span>{envProgressText(envProgress)}</span>
          {envProgress.detail !== undefined ? (
            <span className="oi-env-progress-detail" title={envProgress.detail}>
              {envProgress.detail}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 在指定容器挂载工作台外壳，返回卸载函数。
 */
export function renderWorkbench(options: IWorkbenchOptions): { dispose(): void } {
  const initialTheme = resolveInitialTheme();
  // 首帧渲染前落地主题，避免亮暗闪烁
  applyTheme(initialTheme);
  const root = createRoot(options.container);
  root.render(
    <Workbench
      environment={options.environment ?? { allowAutoForceSearch: false, skipBootstrap: false }}
      services={options.services}
      initialTheme={initialTheme}
      onDirtyStateChange={options.onDirtyStateChange}
    />,
  );
  return toDisposable(() => root.unmount());
}
