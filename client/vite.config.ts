import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBuildInfo } from '../scripts/build-info.mjs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function serviceWorkerPlugin(): Plugin {
  return {
    name: 'talentfly-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const buildAssets = Object.keys(bundle).filter(
        (fileName) => fileName.startsWith('assets/') && /\.(js|css|mjs)$/.test(fileName),
      );
      const buildId = createHash('sha256')
        .update(buildAssets.join('\n'))
        .digest('hex')
        .slice(0, 12);
      const template = readFileSync('sw.template.js', 'utf8');
      const serviceWorker = template
        .replace('__BUILD_ID__', buildId)
        .replace('__BUILD_ASSETS__', JSON.stringify(buildAssets.map((fileName) => `/${fileName}`)));

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorker,
      });
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  define: {
    __TALENTFLY_BUILD_INFO__: JSON.stringify(
      createBuildInfo(fileURLToPath(new URL('./package.json', import.meta.url))),
    ),
  },
  plugins: [react(), serviceWorkerPlugin()],
});
