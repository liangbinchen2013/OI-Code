import { DisposableStore, onUnexpectedError, toDisposable } from '@oi/base';
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
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type {
  ICodeDiagnostic,
  IFileDialogService,
  IFileService,
  IPythonServiceClient,
  IToolchainServiceClient,
} from '@oi/platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorPane, type IEditorPaneHandle } from './editorPane';
import { ProblemsPanel, type IProblemItem } from './problemsPanel';
import { SettingsView } from './settingsView';
import { Sidebar } from './sidebar';
import { WORKBENCH_STRINGS } from './strings';
import { TabBar } from './tabBar';
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
}

export interface IWorkbenchOptions {
  readonly container: HTMLElement;
  readonly services: IWorkbenchServices;
  /** 脏状态上报（主进程据此拦截关闭），由 Code 层提供。 */
  readonly onDirtyStateChange?: (dirty: boolean) => void;
}

type WorkbenchView = 'editor' | 'settings';
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
  const [view, setView] = useState<WorkbenchView>('editor');
  const [theme, setTheme] = useState<ThemeKind>(initialTheme);
  const [status, setStatus] = useState<WorkbenchStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<BusyAction>(undefined);
  const [problems, setProblems] = useState<IProblemItem[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const editorPaneRef = useRef<IEditorPaneHandle | null>(null);
  const tabsRef = useRef<ITabState[]>([]);
  const activeTabIdRef = useRef<string | undefined>(undefined);
  const nextUntitledRef = useRef(1);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const busyRef = useRef(false);
  const problemsRef = useRef(new Map<string, IProblemItem[]>());
  const openFileRef = useRef<() => Promise<void>>(async () => undefined);
  const openFolderRef = useRef<() => Promise<void>>(async () => undefined);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const compileRef = useRef<() => Promise<void>>(async () => undefined);
  const compileRunRef = useRef<() => Promise<void>>(async () => undefined);
  const runRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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
    setView('editor');
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
        setView('editor');
        setStatus('idle');
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
    }
  }, [openUri, services.fileDialogService]);

  const openFolder = useCallback(async (): Promise<void> => {
    const uri = await services.fileDialogService.showOpenFolder({
      title: WORKBENCH_STRINGS.openFolder,
    });
    if (uri) {
      setRootUri(uri);
      setTreeVersion((version) => version + 1);
      setView('editor');
    }
  }, [services.fileDialogService]);

  const newFile = useCallback((): void => {
    const index = nextUntitledRef.current++;
    const name = `${WORKBENCH_STRINGS.untitledPrefix}-${index}`;
    const uri = URI.from({ scheme: 'untitled', path: `/${name}` });
    editorPaneRef.current?.openDocument(uri, '');
    const tab: ITabState = { id: uri.toString(), uri, name, untitled: true, dirty: false };
    setTabs((previous) => [...previous, tab]);
    setActiveTabId(tab.id);
    setView('editor');
  }, []);

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
      const remaining = tabsRef.current.filter((candidate) => candidate.id !== id);
      setTabs(remaining);
      if (activeTabIdRef.current === id) {
        const index = tabsRef.current.findIndex((candidate) => candidate.id === id);
        const next = remaining[Math.min(index, remaining.length - 1)];
        setActiveTabId(next?.id);
        editorPaneRef.current?.setActiveDocument(next?.uri);
      }
    },
    [services.fileDialogService],
  );

  const handleContentChange = useCallback((uri: URI): void => {
    const key = uri.toString();
    setTabs((previous) =>
      previous.map((tab) => (tab.uri.toString() === key ? { ...tab, dirty: true } : tab)),
    );
    setStatus('idle');
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
            return;
          }
          const text = editor.getValue(tab.uri);
          await services.fileService.writeFile(target, text);
          editor.replaceDocument(tab.uri, target, text);
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
        } else {
          await services.fileService.writeFile(tab.uri, editor.getValue(tab.uri));
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
    [services.fileDialogService, services.fileService],
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
        newFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    store.add(toDisposable(() => window.removeEventListener('keydown', onKeyDown)));
  }, [newFile, store]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const statusPresentation = status === 'idle' ? undefined : STATUS_PRESENTATION[status];

  return (
    <div className="oi-workbench">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={(id) => void closeTab(id)}
        onNew={newFile}
        actionsEnabled={activeTab !== undefined}
        busy={busy !== undefined}
        problemCount={problems.length}
        problemsOpen={problemsOpen}
        onCompile={() => void compileRef.current()}
        onRun={() => void runRef.current()}
        onCompileRun={() => void compileRunRef.current()}
        onToggleProblems={() => setProblemsOpen((open) => !open)}
      />
      <div className="oi-body">
        <Sidebar
          rootUri={rootUri}
          treeVersion={treeVersion}
          fileService={services.fileService}
          settingsActive={view === 'settings'}
          onOpenFile={(uri) => void openUri(uri)}
          onOpenFolder={() => void openFolderRef.current()}
          onRefresh={() => setTreeVersion((version) => version + 1)}
          onOpenSettings={() => setView('settings')}
        />
        <main className="oi-main">
          <EditorPane
            ref={editorPaneRef}
            languageService={services.languageService}
            onDidChangeContent={handleContentChange}
            onSaveRequested={() => void saveRef.current()}
          />
          {view === 'settings' ? (
            <SettingsView
              theme={theme}
              canSave={activeTab !== undefined}
              onToggleTheme={toggleTheme}
              onOpenFile={() => void openFileRef.current()}
              onOpenFolder={() => void openFolderRef.current()}
              onSave={() => void saveRef.current()}
            />
          ) : null}
          {view === 'editor' && tabs.length === 0 ? (
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
          {view === 'editor' && problemsOpen ? (
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
