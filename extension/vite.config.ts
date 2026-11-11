import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBuildInfo } from '../scripts/build-info.mjs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { pwaMatchPattern, resolvePwaOrigin } from './src/pwa-origin.ts';

function extensionManifestPlugin(pwaOrigin: string): Plugin {
  return {
    name: 'talentfly-extension-manifest',
    writeBundle(outputOptions) {
      if (!outputOptions.dir) {
        throw new Error('The extension manifest requires a directory build output.');
      }
      const sourceManifest = readFileSync(
        resolve(process.cwd(), 'public/manifest.json'),
        'utf8',
      );
      const manifest = JSON.parse(sourceManifest) as Record<string, unknown>;
      manifest.permissions = ['activeTab', 'scripting'];
      manifest.background = { service_worker: 'service-worker.js', type: 'module' };
      manifest.externally_connectable = {
        matches: [pwaMatchPattern(pwaOrigin)],
      };
      writeFileSync(
        resolve(outputOptions.dir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    },
  };
}

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
        input: {
          popup: resolve(process.cwd(), 'popup.html'),
          'service-worker': resolve(process.cwd(), 'src/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        },
      },
    },
    plugins: [extensionManifestPlugin(pwaOrigin)],
  };
});
