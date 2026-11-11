import { describe, expect, it } from 'vitest';
import { getExtensionBuildInfo } from '../src/build-info';

describe('extension build info', () => {
  it('uses the installed manifest version with the compiled build identity', () => {
    const buildInfo = getExtensionBuildInfo({
      runtime: { getManifest: () => ({ version: '0.2.0' }) },
    });

    expect(buildInfo.version).toBe('0.2.0');
    expect(buildInfo.commit).toBeTruthy();
    expect(Number.isNaN(Date.parse(buildInfo.builtAt))).toBe(false);
  });
});
