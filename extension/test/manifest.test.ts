import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../manifest.json', import.meta.url);

describe('extension workspace', () => {
  it('has a valid Manifest V3 identity and requests no permissions by default', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as {
      manifest_version: number;
      name: string;
      permissions?: string[];
      version: string;
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('TalentFly');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.permissions ?? []).toEqual([]);
  });
});
