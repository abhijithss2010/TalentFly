// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderPopup } from '../src/popup-ui';
import type { JobCapture } from '../src/job-capture';

describe('extension popup', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) throw new Error('Missing test application root');
    root = app;
  });

  it('shows branding, capture action, and the configured PWA link', () => {
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    });

    expect(root.querySelector('h1')?.textContent).toBe('Make your next move count.');
    expect(root.textContent).toContain('The editable preview stays here and is not sent or saved.');
    expect(root.querySelector('.capture-button')?.textContent).toBe('Capture this page');
    expect(root.querySelector('.capture-preview')?.hasAttribute('hidden')).toBe(true);

    const link = root.querySelector<HTMLAnchorElement>('.open-pwa');
    const url = new URL(link?.href ?? '');
    expect(url.origin).toBe('https://talentfly.example');
    expect(url.hash).toBe('#dashboard');
    expect(url.searchParams.get('extensionVersion')).toBe('0.1.0');
    expect(url.searchParams.get('extensionCommit')).toBe('abc123');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
  });

  it('captures on explicit click and shows an editable preview without sending it', async () => {
    const capture: JobCapture = {
      title: 'Frontend Engineer',
      company: 'Example Co',
      location: 'Remote',
      sourceUrl: 'https://jobs.example/123',
      description: 'Build accessible web applications.',
      descriptionTruncated: false,
    };
    let captureCalls = 0;
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    }, async () => {
      captureCalls += 1;
      return capture;
    });

    expect(captureCalls).toBe(0);
    root.querySelector<HTMLButtonElement>('.capture-button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(captureCalls).toBe(1);
    expect(root.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(capture.title);
    expect(root.querySelector<HTMLInputElement>('input[name="company"]')?.value).toBe(capture.company);
    expect(root.querySelector<HTMLInputElement>('input[name="location"]')?.value).toBe(capture.location);
    expect(root.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value).toBe(
      capture.description,
    );
    expect(root.textContent).toContain(`Source page: ${capture.sourceUrl}`);
    expect(root.textContent).toContain('Preview ready. Edit any field before using it.');
    expect(root.querySelector('form')).toBeNull();
  });

  it('shows capture errors and never leaves a success-shaped empty preview', async () => {
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    }, async () => {
      throw new Error('This page does not allow capture. Open a regular webpage and try again.');
    });

    root.querySelector<HTMLButtonElement>('.capture-button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'This page does not allow capture.',
    );
    expect(root.querySelector('.capture-preview')?.hasAttribute('hidden')).toBe(true);
  });
});
