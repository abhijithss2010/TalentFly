import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createBuildInfo } from '../scripts/build-info.mjs';
import { defineConfig, loadEnv } from 'vite';
import { resolvePwaOrigin } from './src/pwa-origin.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const pwaOrigin = resolvePwaOrigin(env.VITE_TALENTFLY_PWA_ORIGIN, mode);

  return {
    define: {
      'import.meta.env.VITE_TALENTFLY_PWA_ORIGIN': JSON.stringify(pwaOrigin),
      __TALENTFLY_BUILD_INFO__: JSON.stringify(
        createBuildInfo(fileURLToPath(new URL('./package.json', import.meta.url))),
      ),
    },
    build: {
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: resolve(process.cwd(), 'popup.html'),
      },
    },
  };
});
