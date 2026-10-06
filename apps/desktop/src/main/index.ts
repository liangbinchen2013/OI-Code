import { app } from 'electron';
import { setUnexpectedErrorHandler, toError } from '@oi/base';
import {
  IFileDialogService,
  IFileService,
  ILogService,
  InstantiationService,
  LogService,
  ServiceCollection,
} from '@oi/platform';
import { NodeFileService } from '@oi/platform/node';
import { FileDialogService } from './fileDialogService';
import { MainProcess } from './mainProcess';

function main(): void {
  const logService = new LogService();
  setUnexpectedErrorHandler((error) => {
    logService.error(toError(error));
  });

  const services = new ServiceCollection();
  services.set(ILogService, logService);
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
