import {
  defineConfig,
  externalizeDepsPlugin,
} from 'electron-vite';
import react from '@vitejs/plugin-react';
import { contentSecurityPolicy } from './src/renderer/csp';

let cspMode: 'development' | 'production' = 'production';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },

  renderer: {
    plugins: [
      react(),
      {
        name: 'shellherd-csp',
        configResolved(c) { cspMode = c.command === 'serve' ? 'development' : 'production'; },
        transformIndexHtml: () => [{
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(cspMode) },
          injectTo: 'head-prepend',
        }],
      },
    ],
  },
});