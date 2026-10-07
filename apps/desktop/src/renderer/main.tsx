import {
  DisposableStore,
  onUnexpectedError,
  setUnexpectedErrorHandler,
  toDisposable,
} from '@oi/base';
import { LanguageService } from '@oi/editor';
import { collectMonacoLanguageContributions } from '@oi/editor/browser';
import {
  AutoSaveServiceClient,
  FileDialogServiceClient,
  FileServiceClient,
  type IMessageTransport,
  JudgeServiceClient,
  LogService,
  PythonServiceClient,
  RpcChannel,
  ToolchainServiceClient,
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

  const toolchainService = new ToolchainServiceClient(channel);
  const pythonService = new PythonServiceClient(channel);
  const judgeService = new JudgeServiceClient(channel);
  const workbench = renderWorkbench({
    container,
    services: {
      fileService: new FileServiceClient(channel),
      fileDialogService: new FileDialogServiceClient(channel),
      languageService: createLanguageService(),
      toolchainService,
      pythonService,
      autoSaveService: new AutoSaveServiceClient(channel),
      judgeService,
    },
    onDirtyStateChange: (dirty) => {
      channel.notify(WINDOW_RPC_NOTIFICATIONS.setDirtyState, { dirty });
    },
  });
  document.documentElement.dataset.oiCodeReady = 'true';

  const disposables = new DisposableStore();
  disposables.add(toolchainService);
  disposables.add(pythonService);
  disposables.add(judgeService);
  disposables.add(workbench);
  disposables.add(channel);
  disposables.add(logService);
  window.addEventListener('unload', () => {
    disposables.dispose();
  });
}

void bootstrap().catch(onUnexpectedError);
