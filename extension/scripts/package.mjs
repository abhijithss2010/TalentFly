import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';

const extensionDirectory = fileURLToPath(new URL('../', import.meta.url));
const distributionDirectory = resolve(extensionDirectory, 'dist');
const artifactDirectory = resolve(extensionDirectory, 'artifacts');
const fixedTimestamp = new Date('1980-01-01T00:00:00.000Z');

export function shouldPackageFile(filePath) {
  const normalizedPath = filePath.split(sep).join('/');
  const fileName = normalizedPath.split('/').at(-1) ?? '';

  return (
    !normalizedPath.startsWith('.') &&
    !normalizedPath.includes('/.') &&
    !/\.map$/i.test(fileName) &&
    !/^\.env(?:\.|$)/i.test(fileName) &&
    !/\.(?:pem|key|log)$/i.test(fileName) &&
    !/service[-_]?account/i.test(fileName)
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to package symbolic link: ${relative(distributionDirectory, absolutePath)}`);
    }

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
    } else if (entry.isFile()) {
      const archivePath = relative(distributionDirectory, absolutePath);
      if (shouldPackageFile(archivePath)) {
        files.push([archivePath, await readFile(absolutePath)]);
      }
    }
  }

  return files;
}

export function createExtensionArchive(entries) {
  const archiveEntries = Object.fromEntries(
    [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, contents]) => [
        name,
        [contents, { mtime: fixedTimestamp }],
      ]),
  );

  return zipSync(archiveEntries, { level: 9, mtime: fixedTimestamp });
}

async function packageExtension() {
  const manifestPath = resolve(distributionDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.action?.default_popup || manifest.manifest_version !== 3) {
    throw new Error('Built extension manifest is missing its Manifest V3 popup configuration.');
  }

  const entries = await collectFiles(distributionDirectory);
  const packagedFiles = new Set(entries.map(([name]) => name));
  if (!packagedFiles.has('manifest.json')) {
    throw new Error('The extension package does not contain manifest.json.');
  }
  if (!packagedFiles.has(manifest.action.default_popup)) {
    throw new Error(`The configured popup is missing from the package: ${manifest.action.default_popup}`);
  }
  for (const iconPath of Object.values(manifest.icons ?? {})) {
    if (typeof iconPath !== 'string' || !packagedFiles.has(iconPath)) {
      throw new Error(`An extension icon is missing from the package: ${String(iconPath)}`);
    }
  }

  const archive = createExtensionArchive(entries);
  await mkdir(artifactDirectory, { recursive: true });
  const outputPath = resolve(
    artifactDirectory,
    `talentfly-extension-v${manifest.version}.zip`,
  );
  await writeFile(outputPath, archive);
  console.log(`Created ${relative(extensionDirectory, outputPath)} (${entries.length} files).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await packageExtension();
}
