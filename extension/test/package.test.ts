import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createExtensionArchive, shouldPackageFile } from '../scripts/package.mjs';

describe('extension packaging', () => {
  it('excludes source maps, environment files, and credential-like files', () => {
    expect(shouldPackageFile('popup.html')).toBe(true);
    expect(shouldPackageFile('.env.production')).toBe(false);
    expect(shouldPackageFile('assets/popup.js.map')).toBe(false);
    expect(shouldPackageFile('secrets/private.key')).toBe(false);
    expect(shouldPackageFile('service-account-prod.json')).toBe(false);
  });

  it('creates a deterministic ZIP with only its supplied packaged files', () => {
    const entries = [
      ['popup.html', new TextEncoder().encode('<main>TalentFly</main>')],
      ['manifest.json', new TextEncoder().encode('{"manifest_version":3}')],
    ] as const;

    const first = createExtensionArchive(entries);
    const second = createExtensionArchive(entries);
    const files = unzipSync(first);

    expect(first).toEqual(second);
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'popup.html']);
  });
});
