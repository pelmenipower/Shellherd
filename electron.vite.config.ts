import {
  defineConfig,
  externalizeDepsPlugin,
} from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { contentSecurityPolicy } from './src/renderer/csp';

// Release builds (SHELLHERD_RELEASE=1) drop the labs and the media window entries (B4).
const labs = process.env.SHELLHERD_RELEASE !== '1';

let cspMode: 'development' | 'production' = 'production';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __SHELLHERD_LABS__: JSON.stringify(labs) },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          ...(labs ? { 'remote-media': resolve('src/preload/remote-media.ts') } : {}),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },

  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          ...(labs ? { 'remote-media': resolve('src/renderer/remote-media.html') } : {}),
        },
      },
    },
    plugins: [
      react(),
      {
        name: 'shellherd-csp',
        configResolved(c) { cspMode = c.command === 'serve' ? 'development' : 'production'; },
        transformIndexHtml: (_html, ctx) => [{
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(cspMode, ctx.filename.endsWith('remote-media.html') ? 'remoteMedia' : 'main') },
          injectTo: 'head-prepend',
        }],
      },
    ],
  },
});