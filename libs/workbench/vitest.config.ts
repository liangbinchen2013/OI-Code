import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'workbench',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
