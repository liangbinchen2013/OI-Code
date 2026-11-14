import { join } from 'node:path';
import { app } from 'electron';
import { setUnexpectedErrorHandler, toError } from '@oi/base';
import {
  IAutoSaveService,
  IConfigService,
  IFileDialogService,
  IFileService,
  IJudgeService,
  ILogService,
  IPythonService,
  IRunnerService,
  IToolchainService,
  IVjudgeService,
  InstantiationService,
  LogService,
  ServiceCollection,
  SyncDescriptor,
} from '@oi/platform';
import { JsonConfigService, NodeFileService } from '@oi/platform/node';
import { AutoSaveService } from './autoSaveService';
import { FileDialogService } from './fileDialogService';
import { JudgeService } from './judgeService';
import { MainProcess } from './mainProcess';
import { PythonService } from './pythonService';
import { RunnerService } from './runnerService';
import { ToolchainService } from './toolchainService';
import { VjudgeService } from './vjudgeService';

/**
 * Windows 的“输入时隐藏指针”会让保存/确认对话框打开期间光标一直不可见：
 * Chromium 在按键时隐藏光标，而模态对话框禁用了父窗口，父窗口收不到恢复光标的鼠标事件。
 * 见 electron/electron#54630。
 */
function disableHideCursorWhileTyping(): void {
  if (process.platform !== 'win32') {
    return;
  }
  const features = app.commandLine
    .getSwitchValue('disable-features')
    .split(',')
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0);
  if (features.includes('HideCursorWhileTyping')) {
    return;
  }
  app.commandLine.appendSwitch(
    'disable-features',
    [...features, 'HideCursorWhileTyping'].join(','),
  );
}

function main(): void {
  disableHideCursorWhileTyping();
  const userDataPath = process.env['OI_CODE_USER_DATA'];
  if (userDataPath) {
    app.setPath('userData', userDataPath);
  }

  const logService = new LogService();
  setUnexpectedErrorHandler((error) => {
    logService.error(toError(error));
  });

  const services = new ServiceCollection();
  services.set(ILogService, logService);
  services.set(
    IConfigService,
    new SyncDescriptor(JsonConfigService, [join(app.getPath('userData'), 'oi-code-config.json')]),
  );
  services.set(
    IRunnerService,
    new SyncDescriptor(RunnerService, [join(app.getPath('userData'), 'runner')]),
  );
  services.set(IToolchainService, new SyncDescriptor(ToolchainService));
  services.set(IPythonService, new SyncDescriptor(PythonService));
  services.set(IFileService, new NodeFileService());
  services.set(IFileDialogService, new FileDialogService());
  // 自动保存草稿目录：默认系统临时目录；E2E 经环境变量隔离到独立 userData
  const autoSaveDirectory =
    process.env['OI_CODE_AUTOSAVE_DIR'] ?? join(app.getPath('temp'), 'oi-code-autosave');
  services.set(IAutoSaveService, new SyncDescriptor(AutoSaveService, [autoSaveDirectory]));
  services.set(IJudgeService, new SyncDescriptor(JudgeService));
  services.set(IVjudgeService, new SyncDescriptor(VjudgeService));
  const instantiationService = new InstantiationService(services);
  const mainProcess = instantiationService.createInstance(MainProcess);

  app.on('will-quit', () => {
    mainProcess.dispose();
    instantiationService.dispose();
    logService.dispose();
  });

  mainProcess.start();
}

main();
