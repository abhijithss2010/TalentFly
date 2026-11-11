import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const extensionDirectory = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = new URL('../public/talentfly-mark.svg', import.meta.url);
const iconDirectory = resolve(extensionDirectory, 'public/icons');
const source = await readFile(sourcePath);

await mkdir(iconDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await sharp(source).resize(size, size).png().toFile(resolve(iconDirectory, `icon${size}.png`));
}
