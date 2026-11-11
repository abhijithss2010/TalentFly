import { describe, expect, it } from 'vitest';
import { BUILD_INFO } from './build-info.js';
import { MetaController } from './meta.controller.js';

describe('MetaController', () => {
  it('returns the server version, commit, and build timestamp', () => {
    expect(new MetaController().getVersion()).toEqual(BUILD_INFO);
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILD_INFO.commit).toBeTruthy();
    expect(Number.isNaN(Date.parse(BUILD_INFO.builtAt))).toBe(false);
  });
});
