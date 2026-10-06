import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const appRoot = dirname(fileURLToPath(import.meta.url));

const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";

// 开发模式的 React 插件会注入内联脚本，严格 CSP 只对构建产物生效
function productionCspPlugin(): Plugin {
  return {
    name: 'oi-code:production-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<!--csp-->',
          `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`,
        ),
    },
  };
}

export default defineConfig({
  root: resolve(appRoot, 'src/renderer'),
  base: './',
  plugins: [react(), productionCspPlugin()],
  build: {
    outDir: resolve(appRoot, '../../dist/desktop/renderer'),
    emptyOutDir: true,
    target: 'esnext',
  },
});
