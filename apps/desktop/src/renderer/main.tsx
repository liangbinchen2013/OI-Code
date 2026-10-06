import { onUnexpectedError, setUnexpectedErrorHandler, toDisposable } from '@oi/base';
import { LanguageService } from '@oi/editor';
import { collectMonacoLanguageContributions } from '@oi/editor/browser';
import {
  FileDialogServiceClient,
  FileServiceClient,
  type IMessageTransport,
  LogService,
  RpcChannel,
  WINDOW_RPC_NOTIFICATIONS,
  WORKBENCH_COMMANDS,
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
  for (const contribution of collectMonacoLanguageContributions()) {
    try {
      languageService.registerLanguage(contribution);
    } catch (error) {
      logService.warn(`已跳过冲突的语言注册：${contribution.id}`, error);
    }
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
  channel.listen(WINDOW_RPC_NOTIFICATIONS.executeCommand, (params) => {
    const command =
      typeof params === 'object' && params !== null
        ? (params as { command?: unknown }).command
        : undefined;
    switch (command) {
      case WORKBENCH_COMMANDS.openFile:
        workbench.openFile();
        break;
      case WORKBENCH_COMMANDS.save:
        workbench.save();
        break;
      case WORKBENCH_COMMANDS.toggleTheme:
        workbench.toggleTheme();
        break;
      default:
        logService.warn(`已忽略未知工作台命令：${String(command)}`);
    }
  });
  document.documentElement.dataset.oiCodeReady = 'true';

  window.addEventListener('unload', () => {
    channel.dispose();
    workbench.dispose();
    logService.dispose();
  });
}

void bootstrap().catch(onUnexpectedError);
