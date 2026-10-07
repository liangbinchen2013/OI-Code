import { onUnexpectedError } from '@oi/base';
import type { ThemeKind } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faArrowRight,
  faRotate,
  faUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeBrowserTheme,
  normalizeBrowserUrl,
  persistBrowserTheme,
  persistBrowserUrl,
  readStoredBrowserTheme,
  readStoredBrowserUrl,
  type BrowserTheme,
} from './browserSettings';
import { WORKBENCH_STRINGS } from './strings';

/** Electron webview 元素的最小类型面（仅使用到的方法/事件）。 */
interface IWebviewElement extends HTMLElement {
  getURL(): string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
}

interface IWebviewFailLoadEvent {
  readonly errorCode?: number;
  readonly errorDescription?: string;
}

const BROWSER_PARTITION = 'persist:oi-code-browser';

/** 暗色主题：整体反色 + 媒体二次反色，兼容不支持深色的站点。 */
const DARK_THEME_CSS = [
  'html { background-color: #0d1117 !important; }',
  'html { filter: invert(1) hue-rotate(180deg); }',
  'img, video, canvas, picture, svg, iframe { filter: invert(1) hue-rotate(180deg); }',
].join('\n');

export interface IBrowserToolProps {
  readonly hidden?: boolean;
  /** OI-Code 当前主题，供「跟随 OI-Code」选项使用。 */
  readonly appTheme: ThemeKind;
}

/**
 * OI 工具箱内置浏览器：持久化分区（Cookie/登录态保留在 userData），
 * 支持地址栏导航与主题切换（跟随系统 / 跟随 OI-Code / 亮 / 暗）。
 */
export function BrowserTool({ hidden, appTheme }: IBrowserToolProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<IWebviewElement | null>(null);
  const insertedCssKeyRef = useRef<string | undefined>(undefined);
  const themeRef = useRef<BrowserTheme>(readStoredBrowserTheme());
  const appThemeRef = useRef<ThemeKind>(appTheme);
  const [theme, setTheme] = useState<BrowserTheme>(themeRef.current);
  const [address, setAddress] = useState(readStoredBrowserUrl());
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState({ back: false, forward: false });

  const applyTheme = useCallback(async (): Promise<void> => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    const selected = themeRef.current;
    const dark =
      selected === 'dark'
        ? true
        : selected === 'light'
          ? false
          : selected === 'app'
            ? appThemeRef.current === 'dark'
            : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const previousKey = insertedCssKeyRef.current;
    if (previousKey !== undefined) {
      insertedCssKeyRef.current = undefined;
      try {
        await webview.removeInsertedCSS(previousKey);
      } catch (error) {
        onUnexpectedError(error);
      }
    }
    if (dark) {
      try {
        insertedCssKeyRef.current = await webview.insertCSS(DARK_THEME_CSS);
      } catch (error) {
        onUnexpectedError(error);
      }
    }
  }, []);

  // 创建 webview 并绑定导航事件；分区持久化由 partition 属性保证
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) {
      return undefined;
    }
    const webview = document.createElement('webview') as IWebviewElement;
    webview.className = 'oi-browser-view';
    webview.setAttribute('partition', BROWSER_PARTITION);
    webview.setAttribute('src', readStoredBrowserUrl());

    const refreshNavigationState = (): void => {
      const url = webview.getURL();
      setAddress(url);
      persistBrowserUrl(url);
      setHistory({ back: webview.canGoBack(), forward: webview.canGoForward() });
    };
    const onNavigate = (): void => refreshNavigationState();
    const onDomReady = (): void => {
      // 导航后已插入的 CSS 失效，需重新应用
      insertedCssKeyRef.current = undefined;
      void applyTheme();
    };
    const onStartLoading = (): void => setFailed(undefined);
    const onFailLoad = (event: Event): void => {
      const detail = event as unknown as IWebviewFailLoadEvent;
      if (detail.errorCode === -3) {
        return;
      }
      setFailed(detail.errorDescription ?? WORKBENCH_STRINGS.browserLoadFailedUnknown);
    };

    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('dom-ready', onDomReady);
    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-fail-load', onFailLoad);
    stage.appendChild(webview);
    webviewRef.current = webview;

    return () => {
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('dom-ready', onDomReady);
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webview.remove();
      webviewRef.current = null;
    };
  }, [applyTheme]);

  useEffect(() => {
    themeRef.current = normalizeBrowserTheme(theme);
    persistBrowserTheme(theme);
    void applyTheme();
  }, [applyTheme, theme]);

  // 跟随 OI-Code 时响应应用主题切换
  useEffect(() => {
    appThemeRef.current = appTheme;
    if (themeRef.current === 'app') {
      void applyTheme();
    }
  }, [appTheme, applyTheme]);

  // 跟随系统主题时响应系统亮暗切换
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => {
      if (themeRef.current === 'system') {
        void applyTheme();
      }
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [applyTheme]);

  const navigate = useCallback((input: string): void => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    setFailed(undefined);
    void webview.loadURL(normalizeBrowserUrl(input)).catch(onUnexpectedError);
  }, []);

  const goBack = useCallback((): void => {
    webviewRef.current?.goBack();
  }, []);

  const goForward = useCallback((): void => {
    webviewRef.current?.goForward();
  }, []);

  const reload = useCallback((): void => {
    setFailed(undefined);
    webviewRef.current?.reload();
  }, []);

  return (
    <section className="oi-browser" hidden={hidden} aria-label={WORKBENCH_STRINGS.browser}>
      <div className="oi-browser-toolbar">
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-btn-secondary oi-browser-back"
          onClick={goBack}
          disabled={!history.back}
          title={WORKBENCH_STRINGS.browserBack}
          aria-label={WORKBENCH_STRINGS.browserBack}
        >
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-btn-secondary oi-browser-forward"
          onClick={goForward}
          disabled={!history.forward}
          title={WORKBENCH_STRINGS.browserForward}
          aria-label={WORKBENCH_STRINGS.browserForward}
        >
          <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-btn-secondary oi-browser-reload"
          onClick={reload}
          title={WORKBENCH_STRINGS.browserReload}
          aria-label={WORKBENCH_STRINGS.browserReload}
        >
          <FontAwesomeIcon icon={faRotate} aria-hidden="true" />
        </button>
        <span className="oi-browser-spacer" />
        <select
          className="oi-select oi-browser-theme"
          value={theme}
          onChange={(event) => setTheme(normalizeBrowserTheme(event.target.value))}
          title={WORKBENCH_STRINGS.browserTheme}
          aria-label={WORKBENCH_STRINGS.browserTheme}
        >
          <option value="system">{WORKBENCH_STRINGS.browserThemeSystem}</option>
          <option value="app">{WORKBENCH_STRINGS.browserThemeApp}</option>
          <option value="light">{WORKBENCH_STRINGS.browserThemeLight}</option>
          <option value="dark">{WORKBENCH_STRINGS.browserThemeDark}</option>
        </select>
      </div>
      <form
        className="oi-browser-address-row"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(address);
        }}
      >
        <input
          className="oi-input oi-browser-address"
          type="text"
          value={address}
          placeholder={WORKBENCH_STRINGS.browserAddressPlaceholder}
          aria-label={WORKBENCH_STRINGS.browserAddressPlaceholder}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button
          type="submit"
          className="oi-btn oi-btn-secondary oi-browser-go"
          title={WORKBENCH_STRINGS.browserGo}
          aria-label={WORKBENCH_STRINGS.browserGo}
        >
          <FontAwesomeIcon icon={faUpRightFromSquare} aria-hidden="true" />
        </button>
      </form>
      {failed !== undefined ? (
        <p className="oi-browser-error">
          {WORKBENCH_STRINGS.browserLoadFailed.replace('{reason}', failed)}
        </p>
      ) : null}
      <div className="oi-browser-stage" ref={stageRef} />
    </section>
  );
}
