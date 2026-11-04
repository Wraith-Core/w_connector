import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// Every px in the CSS follows the screen (720p .. 8K, ultrawide by height): ui-scale.cjs.
import uiScale from './ui-scale.cjs';

// Strip crossorigin from the injected tags -- inside RedM's CEF a module request can
// fail in CORS mode over nui://, which shows up as a black screen with no error.
const stripCrossorigin = (): Plugin => ({
  name: 'strip-crossorigin',
  enforce: 'post',
  transformIndexHtml(html: string) {
    return html.replace(/\s+crossorigin(=("|')?.*?\2)?/g, '');
  },
});

/* `vite build --mode mock --outDir <scratch>`: the browser stand-in (src/dev/mock.ts) is bundled in front
   of the app. Never used for the resource build. */
const mockEntry = (mode: string): Plugin => ({
  name: 'w-admin-mock-entry',
  transformIndexHtml: { order: 'pre', handler(html: string) {
    if (mode !== 'mock') return html;
    return html
      .replace('<script src="../../nui/spectate.js"></script>', '')
      .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/src/dev/mock.ts"></script>\n  <script type="module" src="/src/main.tsx"></script>');
  } },
});

export default defineConfig(({ mode }) => ({
  define: { __DEV_MAP_TILES__: JSON.stringify('/@fs/' + fileURLToPath(new URL('../../w_map/web/tiles', import.meta.url)).replace(/\\/g, '/')) },
  plugins: [react(), mockEntry(mode), stripCrossorigin()],
  css: { postcss: { plugins: [uiScale()] } },
  base: './',
  // dev only: the mock reads the resource's own locales one folder up
  server: { fs: { allow: ['..', '../../w_map/web/tiles'] } },
  build: {
    /* the resource build writes web/build; a mock build must be given --outDir (default: build-mock) */
    outDir: mode === 'mock' ? 'build-mock' : 'build',
    emptyOutDir: true,
    target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    minify: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css') ? 'assets/app.css' : 'assets/[name][extname]',
      },
    },
  },
}));
