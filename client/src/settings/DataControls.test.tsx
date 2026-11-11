import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupTestDatabases,
  createTestDatabase,
  seedRun,
} from '../test-helpers/local-data';

const downloads = vi.hoisted(() => ({ downloadTextFile: vi.fn() }));
vi.mock('../comparison/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../comparison/download')>()),
  downloadTextFile: downloads.downloadTextFile,
}));

import { DATA_DELETED_EVENT, DataControls } from './DataControls';

async function seedWithCredential() {
  const database = createTestDatabase();
  const services = await database.factory();
  await seedRun(services);
  const now = new Date().toISOString();
  await services.credentials.save({
    id: 'claude',
    format: 'talentfly-credential-v1',
    salt: 'c2FsdA==',
    iv: 'aXY=',
    ciphertext: 'U0VDUkVULUNJUEhFUlRFWFQ=',
    iterations: 1,
    createdAt: now,
    updatedAt: now,
  });
  return { ...database, services };
}

beforeEach(() => downloads.downloadTextFile.mockReset());
afterEach(async () => {
  cleanup();
  await cleanupTestDatabases();
});

describe('DataControls', () => {
  it('shows what is stored on the device', async () => {
    const { factory } = await seedWithCredential();
    render(<DataControls serviceFactory={factory} />);
    expect(await screen.findByText(/1 resumes, 1 saved jobs, 1 comparisons\./)).toBeTruthy();
  });

  it('exports everything as JSON but never the encrypted API keys', async () => {
    const { factory } = await seedWithCredential();
    render(<DataControls serviceFactory={factory} />);
    await screen.findByText(/1 comparisons/);

    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }));
    await screen.findByText(/Export saved/);

    expect(downloads.downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content, mime] = downloads.downloadTextFile.mock.calls[0];
    expect(fileName).toMatch(/^talentfly-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe('application/json');
    const parsed = JSON.parse(content as string);
    expect(parsed.format).toBe('talentfly-local-data');
    expect(parsed.data.resumes).toHaveLength(1);
    expect(parsed.data.jobs).toHaveLength(1);
    expect(parsed.data.runs).toHaveLength(1);
    expect(parsed.data.usage).toHaveLength(1);
    expect(parsed.data.runs[0].result.reports[0].report.matchScore).toBe(81);
    expect(content).not.toContain('U0VDUkVULUNJUEhFUlRFWFQ=');
    expect(parsed.data).not.toHaveProperty('credentials');
  });

  it('only deletes after the confirmation word is typed, and removes everything including keys', async () => {
    const { factory, services } = await seedWithCredential();
    const deleted = vi.fn();
    window.addEventListener(DATA_DELETED_EVENT, deleted);
    render(<DataControls serviceFactory={factory} />);
    await screen.findByText(/1 comparisons/);

    expect(screen.getByText(/and your saved encrypted API keys/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data…' }));
    const confirm = screen.getByRole('button', { name: 'Delete everything on this device' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'delete' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((await services.runs.getAll()).length).toBe(1);

    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);

    await screen.findByText('Everything on this device was deleted.');
    expect(await services.resumes.getAll()).toEqual([]);
    expect(await services.jobs.getAll()).toEqual([]);
    expect(await services.runs.getAll()).toEqual([]);
    expect(await services.usage.getAll()).toEqual([]);
    expect(await services.credentials.get('claude')).toBeUndefined();
    expect(deleted).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/0 resumes, 0 saved jobs, 0 comparisons\./)).toBeTruthy());
    window.removeEventListener(DATA_DELETED_EVENT, deleted);
  });

  it('can be cancelled without deleting anything', async () => {
    const { factory, services } = await seedWithCredential();
    render(<DataControls serviceFactory={factory} />);
    await screen.findByText(/1 comparisons/);

    fireEvent.click(screen.getByRole('button', { name: 'Delete all data…' }));
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/Type DELETE to confirm/)).toBeNull();
    expect((await services.runs.getAll()).length).toBe(1);
    expect(await services.credentials.get('claude')).toBeDefined();
  });
});
