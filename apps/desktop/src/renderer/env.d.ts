import type { IPreloadIpcApi } from '@oi/platform';

declare global {
  interface Window {
    readonly oiCode?: IPreloadIpcApi;
  }
}

export {};
