import { onUnexpectedError, setUnexpectedErrorHandler, toDisposable } from '@oi/base';
import { type IMessageTransport, LogService, RpcChannel } from '@oi/platform';
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

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('找不到 #root 挂载点');
  }

  const workbench = renderWorkbench({ container });
  const channel = connectToMain();
  const pong = await channel.call<{ pong: boolean }>('ping');
  if (!pong.pong) {
    throw new Error('IPC 握手失败');
  }
  document.documentElement.dataset.oiCodeReady = 'true';

  window.addEventListener('unload', () => {
    channel.dispose();
    workbench.dispose();
    logService.dispose();
  });
}

void bootstrap().catch(onUnexpectedError);
