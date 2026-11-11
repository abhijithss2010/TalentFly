import { Blob as NodeBlob } from 'node:buffer';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalDataServices,
  createRecordId,
  type LocalDataServices,
} from '../data/local-data-service';
import type { CredentialVault } from '../providers/credential-vault';
import {
  ProviderRegistry,
  type ProviderAdapter,
  type ProviderCompletionRequest,
} from '../providers/provider-adapter';
import { executeRun, resetInterruptedRun, retryRun } from './run-executor';
import { parseRunResult } from './run-result';

const databaseNames: string[] = [];
const opened: LocalDataServices[] = [];

const report = (score: number) => ({
  matchScore: score,
  summary: 'Fit summary.',
  requirements: [
    { requirement: 'Kubernetes', status: 'met', evidence: 'Ran Kubernetes clusters', note: '' },
  ],
  keywordGaps: ['Terraform'],
  suggestions: [{ section: 'Skills', suggestion: 'Add Terraform if true.', evidence: '' }],
});

async function openServices(): Promise<LocalDataServices> {
  const databaseName = `executor-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  const services = await createLocalDataServices({ databaseName, indexedDB });
  opened.push(services);
  return services;
}

function fakeAdapter(
  complete: (request: ProviderCompletionRequest) => Promise<{ text: string; usage: object }>,
): ProviderAdapter {
  return {
    id: 'claude',
    name: 'Claude',
    models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet', description: '' }],
    defaultModel: 'claude-sonnet-5-5',
    complete: vi.fn(complete) as ProviderAdapter['complete'],
    testConnection: vi.fn(async () => undefined),
  };
}

function fakeVault(unlocked = true) {
  return {
    isUnlocked: vi.fn(() => unlocked),
    withApiKey: vi.fn(async (_id: string, op: (key: string) => Promise<unknown>) => op('sk-test')),
    lock: vi.fn(),
  } as unknown as CredentialVault;
}

async function seed(services: LocalDataServices, resumeTexts = ['Ran Kubernetes clusters for four years.']) {
  const now = new Date().toISOString();
  const job = await services.saveCapturedJob({
    id: createRecordId('job'),
    captureMessageId: `capture-${crypto.randomUUID()}`,
    title: 'Platform Engineer',
    company: 'Example',
    sourceUrl: 'https://app.whoz.com/jobs/1',
    description: 'Own the deployment platform.',
    otherFields: { Reference: 'REF-1' },
    createdAt: now,
    updatedAt: now,
  });
  const resumeIds: string[] = [];
  for (const [index, text] of resumeTexts.entries()) {
    const id = createRecordId('resume');
    resumeIds.push(id);
    await services.resumes.save({
      id,
      name: `Resume ${index + 1}`,
      fileName: 'r.pdf',
      mimeType: 'application/pdf',
      fileSize: 1,
      file: new Blob(['x']),
      extractedText: text,
      createdAt: now,
      updatedAt: now,
    });
  }
  await services.settings.save({
    id: 'app',
    defaultResumeId: null,
    preferredProvider: 'claude',
    providerModels: {},
    createdAt: now,
    updatedAt: now,
  });
  const run = await services.createComparisonRun({
    idempotencyKey: `run-${crypto.randomUUID()}`,
    jobId: job.id,
    resumeIds,
  });
  return { job, run, resumeIds };
}

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(async () => {
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

describe('executeRun', () => {
  it('runs received → analysing → done, saves the validated report and the token usage', async () => {
    const services = await openServices();
    const { run } = await seed(services);
    const adapter = fakeAdapter(async () => ({
      text: JSON.stringify(report(82)),
      usage: { inputTokens: 1500, outputTokens: 400 },
    }));
    const progress = vi.fn();

    const finished = await executeRun({
      services,
      runId: run.id,
      registry: new ProviderRegistry([adapter]),
      vault: fakeVault(),
      onProgress: progress,
    });

    expect(finished).toMatchObject({ status: 'done', provider: 'claude', error: undefined });
    const result = parseRunResult(finished.result);
    expect(result?.reports).toHaveLength(1);
    expect(result?.reports[0]).toMatchObject({
      resumeName: 'Resume 1',
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 1500, outputTokens: 400 },
    });
    expect(result?.reports[0].report.matchScore).toBe(82);
    expect(result?.reports[0].report.requirements[0].evidenceVerified).toBe(true);
    expect(progress).toHaveBeenCalledWith({ index: 1, total: 1, resumeName: 'Resume 1' });

    const stored = await services.runs.get(run.id);
    expect(stored?.status).toBe('done');
    expect(parseRunResult(stored?.result)?.reports[0].report.matchScore).toBe(82);
    expect(await services.usage.getAll()).toMatchObject([
      { runId: run.id, provider: 'claude', inputTokens: 1500, outputTokens: 400 },
    ]);
    expect((await services.usage.getAll())[0].estimatedCostUsd).toBeUndefined();
  });

  it('sends the job text including its extra fields and never changes the resume', async () => {
    const services = await openServices();
    const { run, resumeIds } = await seed(services);
    const adapter = fakeAdapter(async () => ({ text: JSON.stringify(report(70)), usage: {} }));
    const before = (await services.resumes.get(resumeIds[0]))?.extractedText;

    await executeRun({ services, runId: run.id, registry: new ProviderRegistry([adapter]), vault: fakeVault() });

    const request = (adapter.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProviderCompletionRequest;
    expect(request.userPrompt).toContain('Reference: REF-1');
    expect(request.userPrompt).toContain('Ran Kubernetes clusters for four years.');
    expect(request.apiKey).toBe('sk-test');
    expect((await services.resumes.get(resumeIds[0]))?.extractedText).toBe(before);
  });

  it('compares resumes one after another and keeps going when one fails', async () => {
    const services = await openServices();
    const { run } = await seed(services, ['First resume text.', 'Second resume text.']);
    let calls = 0;
    const adapter = fakeAdapter(async () => {
      calls += 1;
      if (calls === 1) throw new Error('Claude rate-limited the request. Wait a moment and try again.');
      return { text: JSON.stringify(report(64)), usage: { inputTokens: 10, outputTokens: 5 } };
    });
    const progress = vi.fn();

    const finished = await executeRun({
      services,
      runId: run.id,
      registry: new ProviderRegistry([adapter]),
      vault: fakeVault(),
      onProgress: progress,
    });

    expect(finished.status).toBe('done');
    const result = parseRunResult(finished.result);
    expect(result?.reports.map((entry) => entry.resumeName)).toEqual(['Resume 2']);
    expect(result?.failures).toEqual([
      expect.objectContaining({ resumeName: 'Resume 1', error: expect.stringContaining('rate-limited') }),
    ]);
    expect(progress.mock.calls.map(([p]) => p.index)).toEqual([1, 2]);
  });

  it('fails the run with the provider error when every comparison fails', async () => {
    const services = await openServices();
    const { run } = await seed(services);
    const adapter = fakeAdapter(async () => {
      throw new Error('Claude rejected this API key. Check the key in Provider settings.');
    });

    const finished = await executeRun({
      services,
      runId: run.id,
      registry: new ProviderRegistry([adapter]),
      vault: fakeVault(),
    });

    expect(finished).toMatchObject({
      status: 'failed',
      error: 'Claude rejected this API key. Check the key in Provider settings.',
    });
    expect(parseRunResult(finished.result)?.reports).toEqual([]);
    expect(await services.usage.getAll()).toEqual([]);
  });

  it('records tokens spent on a malformed answer and fails without saving a report', async () => {
    const services = await openServices();
    const { run } = await seed(services);
    const adapter = fakeAdapter(async () => ({
      text: 'Sorry, I cannot produce JSON today.',
      usage: { inputTokens: 900, outputTokens: 20 },
    }));

    const finished = await executeRun({
      services,
      runId: run.id,
      registry: new ProviderRegistry([adapter]),
      vault: fakeVault(),
    });

    expect(finished.status).toBe('failed');
    expect(finished.error).toContain('did not return a structured analysis');
    expect(parseRunResult(finished.result)?.reports).toEqual([]);
    expect(await services.usage.getAll()).toMatchObject([{ inputTokens: 900, outputTokens: 20 }]);
  });

  it('stops when cancelled, keeping the reports already completed', async () => {
    const services = await openServices();
    const { run } = await seed(services, ['First resume text.', 'Second resume text.']);
    const controller = new AbortController();
    const adapter = fakeAdapter(async () => {
      controller.abort();
      return { text: JSON.stringify(report(55)), usage: {} };
    });

    const finished = await executeRun({
      services,
      runId: run.id,
      registry: new ProviderRegistry([adapter]),
      vault: fakeVault(),
      signal: controller.signal,
    });

    expect(finished).toMatchObject({ status: 'failed', error: 'Cancelled before it finished.' });
    expect(parseRunResult(finished.result)?.reports).toHaveLength(1);
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the provider is locked', async (services: LocalDataServices) => services, fakeVault(false), 'Unlock the provider'],
    [
      'no provider is chosen',
      async (services: LocalDataServices) => {
        const settings = await services.settings.get('app');
        if (settings) await services.settings.save({ ...settings, preferredProvider: null });
      },
      fakeVault(),
      'Choose a comparison provider',
    ],
    [
      'a resume has no text',
      async (services: LocalDataServices) => {
        for (const resume of await services.resumes.getAll()) {
          await services.resumes.save({ ...resume, extractedText: '   ' });
        }
      },
      fakeVault(),
      'has no readable text',
    ],
    [
      'a resume was deleted',
      async (services: LocalDataServices) => {
        for (const resume of await services.resumes.getAll()) await services.resumes.delete(resume.id);
      },
      fakeVault(),
      'no longer available',
    ],
  ])('leaves the run untouched and retryable when %s', async (_name, setup, vault, message) => {
    const services = await openServices();
    const { run } = await seed(services);
    await setup(services);
    const adapter = fakeAdapter(async () => ({ text: JSON.stringify(report(70)), usage: {} }));

    await expect(
      executeRun({ services, runId: run.id, registry: new ProviderRegistry([adapter]), vault }),
    ).rejects.toThrow(message);

    expect((await services.runs.get(run.id))?.status).toBe('received');
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it('refuses to run a run that is not waiting, so a retried message cannot double-spend', async () => {
    const services = await openServices();
    const { run } = await seed(services);
    const adapter = fakeAdapter(async () => ({ text: JSON.stringify(report(70)), usage: {} }));
    const registry = new ProviderRegistry([adapter]);

    await executeRun({ services, runId: run.id, registry, vault: fakeVault() });
    await expect(
      executeRun({ services, runId: run.id, registry, vault: fakeVault() }),
    ).rejects.toThrow('already done');
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it('lets a failed run be retried and an interrupted run be reset, but never reopens a finished run', async () => {
    const services = await openServices();
    const { run } = await seed(services);
    let fail = true;
    const adapter = fakeAdapter(async () => {
      if (fail) throw new Error('Claude is temporarily unavailable (HTTP 529).');
      return { text: JSON.stringify(report(77)), usage: {} };
    });
    const registry = new ProviderRegistry([adapter]);

    expect((await executeRun({ services, runId: run.id, registry, vault: fakeVault() })).status).toBe('failed');
    fail = false;
    expect((await retryRun(services, run.id)).status).toBe('received');
    const done = await executeRun({ services, runId: run.id, registry, vault: fakeVault() });
    expect(done.status).toBe('done');
    await expect(retryRun(services, run.id)).rejects.toThrow('cannot transition from "done"');

    const second = await seed(services);
    await services.transitionRun(second.run.id, 'analysing');
    const reset = await resetInterruptedRun(services, second.run.id);
    expect(reset).toMatchObject({ status: 'received', error: undefined });
  });
});
