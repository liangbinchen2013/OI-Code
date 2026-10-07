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
  faFileLines,
  faFolderOpen,
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
  IPythonServiceClient,
  IToolchainServiceClient,
} from '@oi/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityBar, type ActivityView } from './activityBar';
import { EditorPane, type IEditorPaneHandle } from './editorPane';
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
import { ToolboxPanel } from './oiToolbox';
import { PreviewPanel } from './previewPanel';
import { ProblemsPanel, type IProblemItem } from './problemsPanel';
import { SettingsView } from './settingsView';
import { ExplorerPanel } from './sidebar';
import { WORKBENCH_STRINGS } from './strings';
import { TabBar } from './tabBar';
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_TEMPLATE,
  loadCustomTemplates,
  saveCustomTemplates,
  type IFileTemplate,
} from './templates';
import { applyTheme, persistTheme, readStoredTheme, resolveInitialTheme } from './theme';
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
}

export interface IWorkbenchOptions {
  readonly container: HTMLElement;
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
  | 'needSave';
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

interface IWorkbenchProps {
  readonly services: IWorkbenchServices;
  readonly initialTheme: ThemeKind;
  readonly onDirtyStateChange?: (dirty: boolean) => void;
}

function Workbench({ services, initialTheme, onDirtyStateChange }: IWorkbenchProps) {
  const [store] = useState(() => new DisposableStore());
  const [tabs, setTabs] = useState<ITabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined);
  const [rootUri, setRootUri] = useState<URI | undefined>(undefined);
  const [treeVersion, setTreeVersion] = useState(0);
  const [activityView, setActivityView] = useState<ActivityView>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredSidebarWidth());
  const [lastExpandedWidth, setLastExpandedWidth] = useState(() => readStoredLastExpandedWidth());
  const [customTemplates, setCustomTemplates] = useState<readonly IFileTemplate[]>(() =>
    loadCustomTemplates(),
  );
  const [split, setSplit] = useState(() => readStoredSplit());
  const [contentVersion, setContentVersion] = useState(0);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
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

  const activateTab = useCallback((id: string): void => {
    setActiveTabId(id);
    const tab = tabsRef.current.find((candidate) => candidate.id === id);
    if (tab) {
      editorPaneRef.current?.setActiveDocument(tab.uri);
    }
  }, []);

  const openUri = useCallback(
    async (uri: URI): Promise<void> => {
      const key = uri.toString();
      const existing = tabsRef.current.find((tab) => tab.uri.toString() === key);
      if (existing) {
        activateTab(existing.id);
        return;
      }
      try {
        const text = await services.fileService.readFile(uri);
        editorPaneRef.current?.openDocument(uri, text);
        const tab: ITabState = {
          id: key,
          uri,
          name: fileNameOf(uri),
          untitled: false,
          dirty: false,
        };
        setTabs((previous) => [...previous, tab]);
        setActiveTabId(tab.id);
        setStatus('idle');
        scheduleCheckRef.current(tab, 0);
      } catch (error) {
        setStatus('openFailed');
        onUnexpectedError(error);
      }
    },
    [activateTab, services.fileService],
  );

  const openFile = useCallback(async (): Promise<void> => {
    const uri = await services.fileDialogService.showOpenFile({
      title: WORKBENCH_STRINGS.openFile,
    });
    if (uri) {
      await openUri(uri);
      editorPaneRef.current?.focus();
    }
  }, [openUri, services.fileDialogService]);

  const openFolder = useCallback(async (): Promise<void> => {
    const uri = await services.fileDialogService.showOpenFolder({
      title: WORKBENCH_STRINGS.openFolder,
    });
    if (uri) {
      setRootUri(uri);
      setTreeVersion((version) => version + 1);
    }
  }, [services.fileDialogService]);

  const createFromTemplate = useCallback((template: IFileTemplate): void => {
    const index = nextUntitledRef.current++;
    const extension = template.extension.trim().replace(/^\./, '');
    const base = `${WORKBENCH_STRINGS.untitledPrefix}-${index}`;
    const name = extension.length > 0 ? `${base}.${extension}` : base;
    const uri = URI.from({ scheme: 'untitled', path: `/${name}` });
    editorPaneRef.current?.openDocument(uri, template.content);
    const tab: ITabState = { id: uri.toString(), uri, name, untitled: true, dirty: false };
    setTabs((previous) => [...previous, tab]);
    setActiveTabId(tab.id);
    setNewMenuOpen(false);
  }, []);

  const newDefaultFile = useCallback((): void => {
    createFromTemplate(DEFAULT_TEMPLATE);
  }, [createFromTemplate]);

  const updateCustomTemplates = useCallback((next: readonly IFileTemplate[]): void => {
    setCustomTemplates(next);
    saveCustomTemplates(next);
  }, []);

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
      clearAutoSaveDraft(tab.uri);
      const pendingTimer = checkTimersRef.current.get(tab.id);
      if (pendingTimer !== undefined) {
        store.delete(pendingTimer);
        pendingTimer.dispose();
        checkTimersRef.current.delete(tab.id);
      }
      // 令在途的实时检查结果失效
      checkTokensRef.current.set(tab.id, (checkTokensRef.current.get(tab.id) ?? 0) + 1);
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

  const handleContentChange = useCallback((uri: URI): void => {
    const key = uri.toString();
    setTabs((previous) =>
      previous.map((tab) => (tab.uri.toString() === key ? { ...tab, dirty: true } : tab)),
    );
    setContentVersion((version) => version + 1);
    setStatus('idle');
    const tab = tabsRef.current.find((candidate) => candidate.uri.toString() === key);
    if (tab !== undefined) {
      scheduleCheckRef.current(tab, LIVE_CHECK_DEBOUNCE_MS);
    }
  }, []);

  const save = useCallback(
    async function saveLoop(): Promise<void> {
      const tab = tabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current);
      const editor = editorPaneRef.current;
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
            defaultPath: tab.name,
          });
          if (!target) {
            setStatus('idle');
            editor.focus();
            return;
          }
          const text = editor.getValue(tab.uri);
          await services.fileService.writeFile(target, text);
          editor.replaceDocument(tab.uri, target, text);
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
    [clearAutoSaveDraft, services.fileDialogService, services.fileService],
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
      return languageId === 'cpp' || languageId === 'python' ? languageId : undefined;
    },
    [services.languageService],
  );

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
      const tab = tabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current);
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
        setStatusDetail(undefined);
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
    const tab = tabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current);
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
      setStatusDetail(undefined);
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
      if (editorPaneRef.current?.hasDocument(problem.uri) !== true) {
        await openUri(problem.uri);
      }
      editorPaneRef.current?.revealPosition(problem.uri, problem.line, problem.column);
    },
    [openUri],
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
    store.add(toDisposable(() => window.removeEventListener('keydown', onKeyDown)));
  }, [newDefaultFile, store]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const statusPresentation = status === 'idle' ? undefined : STATUS_PRESENTATION[status];
  const splitActive = split.direction !== null && activeTab !== undefined;
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
        activeTabId={activeTabId}
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
        templates={[...BUILT_IN_TEMPLATES, ...customTemplates]}
        newMenuOpen={newMenuOpen}
        onToggleNewMenu={() => setNewMenuOpen((open) => !open)}
        onCloseNewMenu={() => setNewMenuOpen(false)}
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
                onOpenFile={(uri) => void openUri(uri)}
                onOpenFolder={() => void openFolderRef.current()}
                onRefresh={() => setTreeVersion((version) => version + 1)}
              />
              <ToolboxPanel hidden={activityView !== 'toolbox'} />
              <SettingsView
                theme={theme}
                canSave={activeTab !== undefined}
                hidden={activityView !== 'settings'}
                onToggleTheme={toggleTheme}
                onOpenFile={() => void openFileRef.current()}
                onOpenFolder={() => void openFolderRef.current()}
                onSave={() => void saveRef.current()}
                toolchainService={services.toolchainService}
                pythonService={services.pythonService}
                templates={customTemplates}
                onTemplatesChange={updateCustomTemplates}
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
                  <PreviewPanel document={previewDocument} />
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
      services={options.services}
      initialTheme={initialTheme}
      onDirtyStateChange={options.onDirtyStateChange}
    />,
  );
  return toDisposable(() => root.unmount());
}
