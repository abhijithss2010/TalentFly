import { act, fireEvent, render, screen } from '@testing-library/react';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, parseRoute } from './App';

describe('PWA workspace shell', () => {
  it('navigates between workspace sections', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Resume library/ }));

    expect(screen.getByRole('heading', { name: 'Resume library', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Keep your experience close.' })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: /Captured jobs/ }));
    expect(screen.getByRole('heading', { name: 'Captured jobs', level: 1 })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
  });

  it('offers to apply an available service-worker update', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<App />);

    act(() => {
      window.dispatchEvent(new Event('talentfly:update-available'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'talentfly:apply-update' }));
  });

  it('shows bundled build information and explains when no extension build is reported', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'About & diagnostics' }));

    expect(screen.getByRole('heading', { name: 'About & diagnostics', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'PWA build' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Server build' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chrome extension' })).toBeTruthy();
    expect(screen.getByText(/No extension build has been reported/)).toBeTruthy();
  });
});

describe('hash routes', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', indexedDB);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses pages and run detail routes, rejecting anything unsafe', () => {
    expect(parseRoute('')).toEqual({ page: 'dashboard' });
    expect(parseRoute('#history')).toEqual({ page: 'history' });
    expect(parseRoute('#history/run_123-abc')).toEqual({ page: 'history', runId: 'run_123-abc' });
    expect(parseRoute('#settings')).toEqual({ page: 'settings' });
    // Run IDs are only meaningful under history, and must look like IDs.
    expect(parseRoute('#inbox/run_123')).toEqual({ page: 'inbox' });
    expect(parseRoute('#history/<script>')).toEqual({ page: 'history' });
    expect(parseRoute('#history/../../etc')).toEqual({ page: 'history' });
    expect(parseRoute('#nonsense/run_1')).toEqual({ page: 'dashboard' });
  });

  it('opens the run detail view from a deep link and the history list from the nav', async () => {
    window.history.replaceState(null, '', '#history/run_missing-1');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Comparison report', level: 1 })).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: 'This comparison could not be found.' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Comparisons' }));
    expect(screen.getByRole('heading', { name: 'Comparisons', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'No comparisons yet.' })).toBeTruthy();
    window.history.replaceState(null, '', '#');
  });

  it('shows the data controls under Settings', async () => {
    window.history.replaceState(null, '', '#settings');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Data controls' })).toBeTruthy();
    window.history.replaceState(null, '', '#');
  });

  it('opens the Usage page from the nav and parses its route', async () => {
    expect(parseRoute('#usage')).toEqual({ page: 'usage' });
    window.history.replaceState(null, '', '#');
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Usage' }));
    expect(screen.getByRole('heading', { name: 'Usage', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'No usage yet.' })).toBeTruthy();
    window.history.replaceState(null, '', '#');
  });
});
