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
    renderPopup(root, 'https://talentfly.example');

    expect(root.querySelector('h1')?.textContent).toBe('Make your next move count.');
    expect(root.textContent).toContain('Job-page capture and resume selection are coming');

    const link = root.querySelector<HTMLAnchorElement>('.open-pwa');
    expect(link?.href).toBe('https://talentfly.example/#dashboard');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
  });
});
