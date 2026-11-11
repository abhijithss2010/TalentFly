import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBuildInfo } from '../../scripts/build-info.mjs';

const info = createBuildInfo(fileURLToPath(new URL('../package.json', import.meta.url)));
const outputPath = new URL('../src/build-info.generated.ts', import.meta.url);

await writeFile(
  outputPath,
  `export const BUILD_INFO = Object.freeze(${JSON.stringify(info)});\n`,
);
console.log(`Generated build info for server ${info.version} (${info.commit}).`);
