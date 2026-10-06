import { join } from 'node:path';
import { app } from 'electron';
import { setUnexpectedErrorHandler, toError } from '@oi/base';
import {
  IConfigService,
  IFileDialogService,
  IFileService,
  ILogService,
  IPythonService,
  IRunnerService,
  IToolchainService,
  InstantiationService,
  LogService,
  ServiceCollection,
  SyncDescriptor,
} from '@oi/platform';
import { JsonConfigService, NodeFileService } from '@oi/platform/node';
import { FileDialogService } from './fileDialogService';
import { MainProcess } from './mainProcess';
import { PythonService } from './pythonService';
import { RunnerService } from './runnerService';
import { ToolchainService } from './toolchainService';

function main(): void {
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
