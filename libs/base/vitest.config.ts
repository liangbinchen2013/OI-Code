import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'base',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
