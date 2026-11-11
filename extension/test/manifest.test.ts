import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../public/manifest.json', import.meta.url);

describe('extension workspace', () => {
  it('has a valid Manifest V3 identity and only requests temporary tab capture permissions', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as {
      action?: { default_popup?: string };
      manifest_version: number;
      name: string;
      permissions?: string[];
      host_permissions?: string[];
      icons?: Record<string, string>;
      version: string;
    };
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('TalentFly');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.permissions ?? []).toEqual(['activeTab', 'scripting']);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(manifest.icons).toMatchObject({
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    });

    for (const size of [16, 32, 48, 128]) {
      const icon = await readFile(new URL(`../public/icons/icon${size}.png`, import.meta.url));
      expect(icon.readUInt32BE(0)).toBe(0x89504e47);
    }
  });
});
