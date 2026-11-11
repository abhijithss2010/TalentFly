import { Blob as NodeBlob } from 'node:buffer';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalDataServices,
  createRecordId,
  type LocalDataServices,
} from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord } from '../data/models';
import type { CredentialVault } from '../providers/credential-vault';
import {
  ProviderRegistry,
  type ProviderAdapter,
  type ProviderCompletionRequest,
} from '../providers/provider-adapter';
import { RunPanel } from './RunPanel';

const databaseNames: string[] = [];
const opened: LocalDataServices[] = [];

const modelReport = {
  matchScore: 78,
  summary: 'Solid platform background.',
  requirements: [
    { requirement: 'Kubernetes', status: 'met', evidence: 'Ran Kubernetes clusters', note: 'Direct' },
    { requirement: 'AWS', status: 'met', evidence: 'Certified AWS architect', note: 'Invented' },
  ],
  keywordGaps: ['Terraform'],
  suggestions: [
    { section: 'Skills', suggestion: 'Mention Terraform if you use it.', evidence: '' },
  ],
};

async function setup(options: { hasKey?: boolean; unlocked?: boolean } = {}) {
  const { hasKey = true, unlocked = false } = options;
  const databaseName = `run-panel-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  const services = await createLocalDataServices({ databaseName, indexedDB });
  opened.push(services);
  const now = new Date().toISOString();
  const job: JobRecord = await services.saveCapturedJob({
    id: createRecordId('job'),
    captureMessageId: `capture-${crypto.randomUUID()}`,
    title: 'Platform Engineer',
    sourceUrl: 'https://app.whoz.com/jobs/1',
    description: 'Own the deployment platform.',
    createdAt: now,
    updatedAt: now,
  });
  const resumeId = createRecordId('resume');
  await services.resumes.save({
    id: resumeId,
    name: 'My resume',
    fileName: 'r.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 1,
    file: new Blob(['x']),
    extractedText: 'Ran Kubernetes clusters for four years.',
    createdAt: now,
    updatedAt: now,
  });
  await services.settings.save({
    id: 'app',
    defaultResumeId: null,
    preferredProvider: 'claude',
    providerModels: {},
    createdAt: now,
    updatedAt: now,
  });
  const run = await services.createComparisonRun({
    idempotencyKey: `k-${crypto.randomUUID()}`,
    jobId: job.id,
    resumeIds: [resumeId],
  });

  let isUnlocked = unlocked;
  const vault = {
    hasCredential: vi.fn(async () => hasKey),
    isUnlocked: vi.fn(() => isUnlocked),
    unlock: vi.fn(async (_id: string, passphrase: string) => {
      if (passphrase !== 'right-passphrase') throw new Error('The passphrase is incorrect.');
      isUnlocked = true;
    }),
    lock: vi.fn(() => {
      isUnlocked = false;
    }),
    withApiKey: vi.fn(async (_id: string, op: (key: string) => Promise<unknown>) => op('sk-test')),
  } as unknown as CredentialVault;

  const complete = vi.fn(async (_request: ProviderCompletionRequest) => ({
    text: JSON.stringify(modelReport),
    usage: { inputTokens: 1000, outputTokens: 250 },
  }));
  const adapter: ProviderAdapter = {
    id: 'claude',
    name: 'Claude',
    models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet', description: '' }],
    defaultModel: 'claude-sonnet-5-5',
    complete: complete as ProviderAdapter['complete'],
    testConnection: vi.fn(async () => undefined),
  };
  return { services, job, run, vault, complete, registry: new ProviderRegistry([adapter]) };
}

/** Re-renders with the latest stored run, like the inbox does after onChanged. */
function Harness({
  services,
  initialRun,
  job,
  vault,
  registry,
}: {
  services: LocalDataServices;
  initialRun: ComparisonRunRecord;
  job: JobRecord;
  vault: CredentialVault;
  registry: ProviderRegistry;
}) {
  return <HarnessInner {...{ services, initialRun, job, vault, registry }} />;
}

import { useState } from 'react';
function HarnessInner({ services, initialRun, job, vault, registry }: Parameters<typeof Harness>[0]) {
  const [run, setRun] = useState(initialRun);
  return (
    <RunPanel
      services={services}
      run={run}
      job={job}
      registry={registry}
      createVault={() => vault}
      onChanged={() => {
        void services.runs.get(run.id).then((latest) => latest && setRun(latest));
      }}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  opened.splice(0).forEach((services) => services.close());
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
});

describe('RunPanel', () => {
  it('shows exactly what will be sent and sends nothing until the user confirms', async () => {
    const { services, run, job, vault, registry, complete } = await setup();
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));

    expect(await screen.findByText(/using your own API key/)).toBeTruthy();
    expect(screen.getByText('Show the exact text that will be sent')).toBeTruthy();
    expect(screen.getByText(/Ran Kubernetes clusters for four years\./)).toBeTruthy();
    expect(screen.getByText(/Own the deployment platform\./)).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it('asks for the passphrase, runs the comparison, saves and shows the report, then locks the key', async () => {
    const { services, run, job, vault, registry, complete } = await setup();
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));

    const send = await screen.findByRole('button', { name: 'Send to Claude' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Passphrase for your saved Claude key/), {
      target: { value: 'right-passphrase' },
    });
    fireEvent.click(send);

    expect(await screen.findByLabelText('Report for My resume')).toBeTruthy();
    expect(screen.getByText('Solid platform background.')).toBeTruthy();
    expect(screen.getByText('78')).toBeTruthy();
    expect(screen.getByText('Mention Terraform if you use it.')).toBeTruthy();
    // Quoted evidence is shown only when it really is in the resume.
    expect(screen.getByText('“Ran Kubernetes clusters”')).toBeTruthy();
    expect(screen.getByText(/which was not found in this resume/)).toBeTruthy();
    expect(screen.getByText(/Unverified: not based on text found in your resume/)).toBeTruthy();

    expect(complete).toHaveBeenCalledTimes(1);
    expect(vault.unlock).toHaveBeenCalledWith('claude', 'right-passphrase');
    expect(vault.lock).toHaveBeenCalledWith('claude');
    await waitFor(async () => expect((await services.runs.get(run.id))?.status).toBe('done'));
    expect(await services.usage.getAll()).toHaveLength(1);
    // The saved report is shown from storage; no further provider call is needed.
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('keeps the run retryable when the passphrase is wrong', async () => {
    const { services, run, job, vault, registry, complete } = await setup();
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));
    fireEvent.change(await screen.findByLabelText(/Passphrase for your saved Claude key/), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Claude' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The passphrase is incorrect.');
    expect(complete).not.toHaveBeenCalled();
    expect((await services.runs.get(run.id))?.status).toBe('received');
    expect(screen.getByRole('button', { name: 'Review and send for comparison' })).toBeTruthy();
  });

  it('does not ask for a passphrase when the provider is already unlocked', async () => {
    const { services, run, job, vault, registry } = await setup({ unlocked: true });
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));

    const send = await screen.findByRole('button', { name: 'Send to Claude' });
    expect(screen.queryByLabelText(/Passphrase/)).toBeNull();
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  it('explains a missing key and blocks sending', async () => {
    const { services, run, job, vault, registry } = await setup({ hasKey: false });
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));

    expect((await screen.findByRole('alert')).textContent).toContain('No Claude API key is saved');
    expect((screen.getByRole('button', { name: 'Send to Claude' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains when no provider is chosen instead of opening a review', async () => {
    const { services, run, job, vault, registry } = await setup();
    const settings = await services.settings.get('app');
    if (settings) await services.settings.save({ ...settings, preferredProvider: null });
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Choose a comparison provider');
    expect(screen.queryByRole('button', { name: 'Send to Claude' })).toBeNull();
  });

  it('shows a provider failure on the run and lets the user try again', async () => {
    const { services, run, job, vault, registry, complete } = await setup({ unlocked: true });
    complete.mockRejectedValueOnce(
      new Error('Claude rate-limited the request. Wait a moment and try again.'),
    );
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Claude' }));

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getAllByRole('alert').some((node) => node.textContent?.includes('rate-limited'))).toBe(true);

    fireEvent.click(retry);
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send for comparison' }));
    // The key was locked again after the first run, so the passphrase is needed again.
    fireEvent.change(await screen.findByLabelText(/Passphrase for your saved Claude key/), {
      target: { value: 'right-passphrase' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Claude' }));
    expect(await screen.findByLabelText('Report for My resume')).toBeTruthy();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('shows progress and cancels a run in flight', async () => {
    const { services, run, job, vault, registry, complete } = await setup({ unlocked: true });
    complete.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () =>
            reject(new Error('The Claude request was cancelled.')),
          );
        }),
    );
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Claude' }));

    expect(await screen.findByText('Comparing “My resume” (1 of 1)…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(async () => expect((await services.runs.get(run.id))?.status).toBe('failed'));
    expect((await services.runs.get(run.id))?.error).toBe('Cancelled before it finished.');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('lets the user reset a run left analysing by a closed page', async () => {
    const { services, run, job, vault, registry } = await setup();
    const analysing = await services.transitionRun(run.id, 'analysing');
    render(<Harness services={services} initialRun={analysing} job={job} vault={vault} registry={registry} />);

    expect(screen.getByText(/nothing in this window is working on it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset and try again' }));
    expect(await screen.findByRole('button', { name: 'Review and send for comparison' })).toBeTruthy();
  });

  it('shows a saved report without any provider call', async () => {
    const { services, run, job, vault, registry, complete } = await setup({ unlocked: true });
    render(<Harness services={services} initialRun={run} job={job} vault={vault} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review and send for comparison' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Claude' }));
    await screen.findByLabelText('Report for My resume');
    cleanup();

    const saved = await services.runs.get(run.id);
    if (!saved) throw new Error('missing run');
    render(<Harness services={services} initialRun={saved} job={job} vault={vault} registry={registry} />);
    expect(screen.getByLabelText('Report for My resume')).toBeTruthy();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
