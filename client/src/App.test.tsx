import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('PWA workspace shell', () => {
  it('navigates between workspace sections', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Resume library0' }));

    expect(screen.getByRole('heading', { name: 'Resume library', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your next chapter starts here.' })).toBeTruthy();

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
