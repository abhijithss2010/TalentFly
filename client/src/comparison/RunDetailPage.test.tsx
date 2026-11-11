import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderRegistry,
  type ProviderAdapter,
} from '../providers/provider-adapter';
import {
  cleanupTestDatabases,
  createTestDatabase,
  seedRun,
} from '../test-helpers/local-data';

const downloads = vi.hoisted(() => ({ downloadTextFile: vi.fn() }));
vi.mock('./download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./download')>()),
  downloadTextFile: downloads.downloadTextFile,
}));

import { RunDetailPage } from './RunDetailPage';

function spyRegistry() {
  const complete = vi.fn();
  const adapter: ProviderAdapter = {
    id: 'claude',
    name: 'Claude',
    models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet', description: '' }],
    defaultModel: 'claude-sonnet-5-5',
    complete,
    testConnection: vi.fn(),
  };
  return { complete, registry: new ProviderRegistry([adapter]) };
}

beforeEach(() => downloads.downloadTextFile.mockReset());
afterEach(async () => {
  cleanup();
  await cleanupTestDatabases();
});

describe('RunDetailPage', () => {
  it('shows the saved report, job context, and run status without calling a provider', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { run } = await seedRun(services);
    const { complete, registry } = spyRegistry();

    render(<RunDetailPage runId={run.id} serviceFactory={factory} registry={registry} />);

    expect(await screen.findByRole('heading', { name: 'Platform Engineer' })).toBeTruthy();
    expect(screen.getByText('Example Co · Paris, Remote')).toBeTruthy();
    expect(screen.getByText('done', { selector: '.run-status' })).toBeTruthy();
    expect(screen.getByLabelText('Report for Platform resume')).toBeTruthy();
    expect(screen.getByText('Strong infrastructure background.')).toBeTruthy();
    expect(screen.getByText('Terraform', { selector: '.gap-keywords li' })).toBeTruthy();
    expect(screen.getByText('Mention Terraform if you use it.')).toBeTruthy();
    expect(screen.getByText('Reference')).toBeTruthy();
    expect(screen.getByText('REF-42')).toBeTruthy();
    expect(screen.getByText('Own the deployment platform.')).toBeTruthy();
    const source = screen.getByRole('link', { name: 'View source page' });
    expect(source.getAttribute('href')).toBe('https://app.whoz.com/jobs/1');
    expect(source.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: '← All comparisons' }).getAttribute('href')).toBe('#history');

    // Reloading is purely a read of local storage.
    expect(complete).not.toHaveBeenCalled();
  });

  it('exports the report as a Markdown file', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { run } = await seedRun(services);
    render(<RunDetailPage runId={run.id} serviceFactory={factory} registry={spyRegistry().registry} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export as Markdown' }));

    expect(downloads.downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content, mime] = downloads.downloadTextFile.mock.calls[0];
    expect(fileName).toMatch(/^talentfly-platform-engineer-run-.*\.md$/);
    expect(mime).toBe('text/markdown');
    expect(content).toContain('# Platform Engineer: resume comparison');
    expect(content).toContain('**Match: 81/100**');
  });

  it('offers no export for a run that has no report yet', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { run } = await seedRun(services, { done: false });
    render(<RunDetailPage runId={run.id} serviceFactory={factory} registry={spyRegistry().registry} />);

    expect(await screen.findByRole('button', { name: 'Review and send for comparison' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export as Markdown' })).toBeNull();
  });

  it('shows a clear not-found state for an unknown run', async () => {
    const { factory } = createTestDatabase();
    render(<RunDetailPage runId="run_does-not-exist" serviceFactory={factory} />);

    expect(await screen.findByRole('heading', { name: 'This comparison could not be found.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '← All comparisons' })).toBeTruthy();
  });

  it('does not turn an unsafe source URL into a link', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { run } = await seedRun(services, { sourceUrl: 'javascript:alert(1)' });
    render(<RunDetailPage runId={run.id} serviceFactory={factory} registry={spyRegistry().registry} />);

    expect(await screen.findByText('Source: javascript:alert(1)')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View source page' })).toBeNull();
  });

  it('says so when the job was removed but keeps showing the saved report', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { run, job } = await seedRun(services);
    await services.jobs.delete(job.id);
    render(<RunDetailPage runId={run.id} serviceFactory={factory} registry={spyRegistry().registry} />);

    expect(await screen.findByText('The captured job is no longer saved in this browser.')).toBeTruthy();
    expect(screen.getByLabelText('Report for Platform resume')).toBeTruthy();
  });
});
