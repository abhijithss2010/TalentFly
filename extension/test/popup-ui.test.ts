// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderPopup } from '../src/popup-ui';

describe('extension popup', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) throw new Error('Missing test application root');
    root = app;
  });

  it('shows TalentFly branding, next-step guidance, and the configured PWA link', () => {
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    });

    expect(root.querySelector('h1')?.textContent).toBe('Make your next move count.');
    expect(root.textContent).toContain('Job-page capture and resume selection are coming');

    const link = root.querySelector<HTMLAnchorElement>('.open-pwa');
    const url = new URL(link?.href ?? '');
    expect(url.origin).toBe('https://talentfly.example');
    expect(url.hash).toBe('#dashboard');
    expect(url.searchParams.get('extensionVersion')).toBe('0.1.0');
    expect(url.searchParams.get('extensionCommit')).toBe('abc123');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
  });
});
