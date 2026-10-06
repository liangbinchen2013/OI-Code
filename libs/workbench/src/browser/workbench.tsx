import { DisposableStore, onUnexpectedError, toDisposable } from '@oi/base';
import { URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import type { ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleXmark,
  faFileLines,
  faFolderOpen,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { IFileDialogService, IFileService } from '@oi/platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorPane, type IEditorPaneHandle } from './editorPane';
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
}

export interface IWorkbenchOptions {
  readonly container: HTMLElement;
  readonly services: IWorkbenchServices;
  /** 脏状态上报（主进程据此拦截关闭），由 Code 层提供。 */
  readonly onDirtyStateChange?: (dirty: boolean) => void;
}

type WorkbenchView = 'editor' | 'settings';
type WorkbenchStatus = 'idle' | 'saving' | 'saved' | 'saveFailed' | 'openFailed';

interface ITabState {
  readonly id: string;
  readonly uri: URI;
  readonly name: string;
  readonly untitled: boolean;
  readonly dirty: boolean;
}

const STATUS_AUTO_HIDE_MS = 3000;

const STATUS_PRESENTATION: Record<
  Exclude<WorkbenchStatus, 'idle'>,
  { readonly icon: IconDefinition; readonly text: string }
> = {
  saving: { icon: faSpinner, text: WORKBENCH_STRINGS.saving },
  saved: { icon: faCircleCheck, text: WORKBENCH_STRINGS.saved },
  saveFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.saveFailed },
  openFailed: { icon: faCircleXmark, text: WORKBENCH_STRINGS.openFailed },
};

function fileNameOf(uri: URI): string {
  const name = uri.path.split('/').pop();
  return name !== undefined && name.length > 0 ? name : uri.path;
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
  const editorPaneRef = useRef<IEditorPaneHandle | null>(null);
  const tabsRef = useRef<ITabState[]>([]);
  const activeTabIdRef = useRef<string | undefined>(undefined);
  const nextUntitledRef = useRef(1);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const openFileRef = useRef<() => Promise<void>>(async () => undefined);
  const openFolderRef = useRef<() => Promise<void>>(async () => undefined);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

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

  // 结果胶囊几秒后自动消失
  useEffect(() => {
    if (status !== 'saved' && status !== 'saveFailed' && status !== 'openFailed') {
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
    const onKeyDown = (event: KeyboardEvent): void => {
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
          {statusPresentation ? (
            <div
              className={`oi-status-capsule oi-status-${status}`}
              role="status"
              aria-live="polite"
            >
              <FontAwesomeIcon
                icon={statusPresentation.icon}
                spin={status === 'saving'}
                aria-hidden="true"
              />
              <span>{statusPresentation.text}</span>
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
