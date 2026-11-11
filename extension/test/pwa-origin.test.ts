import { describe, expect, it } from 'vitest';
import { pwaMatchPattern, resolvePwaOrigin } from '../src/pwa-origin';

describe('PWA origin configuration', () => {
  it('defaults development builds to the local PWA origin', () => {
    expect(resolvePwaOrigin(undefined, 'development')).toBe('http://localhost:5173');
  });

  it('requires an explicit HTTPS origin for production', () => {
    expect(() => resolvePwaOrigin(undefined, 'production')).toThrow(
      'VITE_TALENTFLY_PWA_ORIGIN must be set',
    );
    expect(resolvePwaOrigin('https://talentfly.example', 'production')).toBe(
      'https://talentfly.example',
    );
  });

  it('rejects insecure public origins and non-origin URLs', () => {
    expect(() => resolvePwaOrigin('http://talentfly.example', 'development')).toThrow('HTTPS');
    expect(() => resolvePwaOrigin('https://talentfly.example/app', 'production')).toThrow(
      'only an origin',
    );
    expect(() => resolvePwaOrigin('https://user:pass@talentfly.example', 'production')).toThrow(
      'only an origin',
    );
  });

  it('creates an exact external-connectable match pattern from the PWA origin', () => {
    expect(pwaMatchPattern('https://talentfly.example')).toBe('https://talentfly.example/*');
    expect(pwaMatchPattern('http://localhost:5173')).toBe('http://localhost:5173/*');
  });
});
