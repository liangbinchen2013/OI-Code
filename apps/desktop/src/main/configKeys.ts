/**
 * 应用配置键：主进程服务与设置页共享的持久化词典。
 */
export const CONFIG_KEYS = {
  gppPath: 'cpp.gppPath',
  gppVersion: 'cpp.compilerVersion',
  cppStandards: 'cpp.supportedStandards',
  cppStandard: 'cpp.standard',
  cppCustomFlags: 'cpp.customFlags',
  cppCandidates: 'cpp.candidates',
  pythonPath: 'python.interpreterPath',
  pythonInterpreters: 'python.interpreters',
  runnerHash: 'runner.sourceHash',
  vjudgeUsername: 'vjudge.username',
} as const;
