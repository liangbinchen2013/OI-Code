import { onUnexpectedError, setUnexpectedErrorHandler, toDisposable } from '@oi/base';
import { BUILTIN_LANGUAGES, LanguageService } from '@oi/editor';
import {
  FileDialogServiceClient,
  FileServiceClient,
  type IMessageTransport,
  LogService,
  RpcChannel,
  WINDOW_RPC_NOTIFICATIONS,
} from '@oi/platform';
import { renderWorkbench } from '@oi/workbench';

const logService = new LogService();
setUnexpectedErrorHandler((error) => {
  logService.error(error instanceof Error ? error : String(error));
});

function connectToMain(): RpcChannel {
  const preload = window.oiCode;
  if (!preload) {
    throw new Error('preload 未注入，无法建立 IPC 连接');
  }
  const transport: IMessageTransport = {
    onMessage: (listener) => toDisposable(preload.ipc.onMessage(listener)),
    send: (message) => preload.ipc.send(message),
  };
  return new RpcChannel(transport);
}

function createLanguageService(): LanguageService {
  const languageService = new LanguageService();
  for (const contribution of BUILTIN_LANGUAGES) {
    languageService.registerLanguage(contribution);
  }
  return languageService;
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('找不到 #root 挂载点');
  }

  const channel = connectToMain();
  const pong = await channel.call<{ pong: boolean }>('ping');
  if (!pong.pong) {
    throw new Error('IPC 握手失败');
  }

  const workbench = renderWorkbench({
    container,
    services: {
      fileService: new FileServiceClient(channel),
      fileDialogService: new FileDialogServiceClient(channel),
      languageService: createLanguageService(),
    },
    onDirtyStateChange: (dirty) => {
      channel.notify(WINDOW_RPC_NOTIFICATIONS.setDirtyState, { dirty });
    },
  });
  document.documentElement.dataset.oiCodeReady = 'true';

  window.addEventListener('unload', () => {
    channel.dispose();
    workbench.dispose();
    logService.dispose();
  });
}

void bootstrap().catch(onUnexpectedError);
