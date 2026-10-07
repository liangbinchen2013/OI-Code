import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  // Electron + g++ 探测资源占用高，串行执行保证稳定性
  workers: 1,
  reporter: [['list']],
});
