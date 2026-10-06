import { DisposableStore, onUnexpectedError, toDisposable } from '@oi/base';
import type { URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleXmark,
  faFloppyDisk,
  faFolderOpen,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { IFileDialogService, IFileService } from '@oi/platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorPane, type IEditorPaneHandle } from './editorPane';
import { WORKBENCH_STRINGS } from './strings';
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

type WorkbenchStatus = 'idle' | 'saving' | 'saved' | 'saveFailed' | 'openFailed';

interface IOpenDocument {
  readonly uri: URI;
  readonly name: string;
}

const OPEN_FILTERS = [
  { name: 'OI 源码', extensions: ['cpp', 'cc', 'cxx', 'h', 'hpp', 'py'] },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: '全部文件', extensions: ['*'] },
];

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

function Workbench({ services, onDirtyStateChange }: Omit<IWorkbenchOptions, 'container'>) {
  const [store] = useState(() => new DisposableStore());
  const [doc, setDoc] = useState<IOpenDocument | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<WorkbenchStatus>('idle');
  const editorPaneRef = useRef<IEditorPaneHandle | null>(null);
  const docRef = useRef<IOpenDocument | undefined>(undefined);
  // 关闭确认依赖主进程缓存的脏状态，编辑瞬间同步上报，避免“编辑后立刻关闭”的竞态
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const openFileRef = useRef<() => Promise<void>>(async () => undefined);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  const setDirtyState = useCallback(
    (value: boolean) => {
      if (dirtyRef.current !== value) {
        dirtyRef.current = value;
        onDirtyStateChange?.(value);
      }
      setDirty(value);
    },
    [onDirtyStateChange],
  );

  const openFile = useCallback(async (): Promise<void> => {
    try {
      if (dirtyRef.current) {
        const confirmed = await services.fileDialogService.confirmDiscardChanges(
          docRef.current?.name,
        );
        if (!confirmed) {
          return;
        }
      }
      const uri = await services.fileDialogService.showOpenFile({
        title: WORKBENCH_STRINGS.openFile,
        filters: OPEN_FILTERS,
      });
      if (!uri) {
        return;
      }
      const text = await services.fileService.readFile(uri);
      editorPaneRef.current?.setContent(text, uri);
      setDoc({ uri, name: fileNameOf(uri) });
      setDirtyState(false);
      setStatus('idle');
    } catch (error) {
      setStatus('openFailed');
      onUnexpectedError(error);
    }
  }, [services.fileDialogService, services.fileService]);

  const save = useCallback(
    async function saveLoop(): Promise<void> {
      const current = docRef.current;
      if (!current || !editorPaneRef.current) {
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
        await services.fileService.writeFile(current.uri, editorPaneRef.current.getValue());
        setDirtyState(false);
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
    [services.fileService],
  );

  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    store.add(toDisposable(() => window.removeEventListener('keydown', onKeyDown)));
  }, [store]);

  const handleContentChange = useCallback(() => {
    setDirtyState(true);
    setStatus('idle');
  }, [setDirtyState]);

  const statusPresentation = status === 'idle' ? undefined : STATUS_PRESENTATION[status];

  return (
    <div className="oi-workbench">
      <header className="oi-topbar">
        <div className="oi-brand">{WORKBENCH_STRINGS.brand}</div>
        <div className="oi-doc-info">
          {doc ? (
            <>
              <span className="oi-doc-name" title={doc.uri.toString()}>
                {doc.name}
              </span>
              {dirty ? (
                <span className="oi-dirty-dot" role="img" aria-label={WORKBENCH_STRINGS.unsaved} />
              ) : null}
            </>
          ) : null}
        </div>
        <div className="oi-topbar-actions">
          <button
            type="button"
            className="oi-btn oi-btn-secondary"
            onClick={() => void openFileRef.current()}
            title={WORKBENCH_STRINGS.openFileTooltip}
          >
            <FontAwesomeIcon icon={faFolderOpen} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.openFile}</span>
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-primary"
            onClick={() => void saveRef.current()}
            disabled={doc === undefined || status === 'saving'}
            title={WORKBENCH_STRINGS.saveTooltip}
          >
            <FontAwesomeIcon icon={faFloppyDisk} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.save}</span>
          </button>
        </div>
      </header>
      <main className="oi-main">
        <EditorPane
          ref={editorPaneRef}
          languageService={services.languageService}
          onDidChangeContent={handleContentChange}
          onSaveRequested={() => void saveRef.current()}
        />
        {doc === undefined ? (
          <div className="oi-empty-state">
            <h1 className="oi-empty-title">{WORKBENCH_STRINGS.emptyTitle}</h1>
            <p className="oi-empty-hint">{WORKBENCH_STRINGS.emptyHint}</p>
            <button
              type="button"
              className="oi-btn oi-btn-primary"
              onClick={() => void openFileRef.current()}
            >
              <FontAwesomeIcon icon={faFolderOpen} aria-hidden="true" />
              <span>{WORKBENCH_STRINGS.openFile}</span>
            </button>
          </div>
        ) : null}
        {statusPresentation ? (
          <div className={`oi-status-capsule oi-status-${status}`} role="status" aria-live="polite">
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
  );
}

/**
 * 在指定容器挂载工作台外壳，返回用于卸载 React 树的释放句柄。
 */
export function renderWorkbench(options: IWorkbenchOptions): { dispose(): void } {
  const root = createRoot(options.container);
  root.render(
    <Workbench services={options.services} onDirtyStateChange={options.onDirtyStateChange} />,
  );
  return toDisposable(() => root.unmount());
}
