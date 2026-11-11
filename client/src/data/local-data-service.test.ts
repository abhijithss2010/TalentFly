import { Blob as NodeBlob } from 'node:buffer';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalDataServices, createRecordId } from './local-data-service';
import type { JobRecord, ResumeRecord } from './models';

const databaseNames: string[] = [];
const openedServices: Awaited<ReturnType<typeof createLocalDataServices>>[] = [];

function uniqueDatabaseName(): string {
  const name = `talentfly-test-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

async function openServices(databaseName = uniqueDatabaseName()) {
  const services = await createLocalDataServices({ databaseName, indexedDB });
  openedServices.push(services);
  return services;
}

function sampleResume(id = createRecordId('resume')): ResumeRecord {
  const now = new Date().toISOString();
  return {
    id,
    name: 'Software Engineer',
    fileName: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 6,
    file: new Blob(['resume'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    extractedText: 'Experience with TypeScript.',
    createdAt: now,
    updatedAt: now,
  };
}

function sampleJob(id = createRecordId('job')): JobRecord {
  const now = new Date().toISOString();
  return {
    id,
    title: 'Frontend Engineer',
    company: 'Example',
    description: 'Build accessible web applications.',
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(async () => {
  openedServices.splice(0).forEach((services) => services.close());
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
  vi.unstubAllGlobals();
});

describe('local data services', () => {
  it('generates prefixed random record IDs and rejects invalid prefixes', () => {
    expect(createRecordId('resume')).toMatch(/^resume_[0-9a-f-]{36}$/i);
    expect(() => createRecordId('bad prefix')).toThrow(
      'Record ID prefixes may contain only letters, numbers, and hyphens.',
    );
  });

  it('persists typed records and file blobs after reopening the database', async () => {
    const name = uniqueDatabaseName();
    const first = await openServices(name);
    const resume = sampleResume();
    const job = sampleJob();
    await first.resumes.save(resume);
    await first.jobs.save(job);
    first.close();

    const reopened = await openServices(name);
    const loadedResume = await reopened.resumes.get(resume.id);

    expect(loadedResume).toMatchObject({
      id: resume.id,
      name: resume.name,
      extractedText: resume.extractedText,
    });
    await expect(loadedResume?.file.text()).resolves.toBe('resume');
    expect(await reopened.jobs.getAll()).toEqual([job]);
  });

  it('exports, validates, and atomically restores local records', async () => {
    const source = await openServices();
    const resume = sampleResume();
    const job = sampleJob();
    await source.resumes.save(resume);
    await source.jobs.save(job);
    await source.settings.save({
      id: 'app',
      defaultResumeId: resume.id,
      preferredProvider: 'claude',
      createdAt: resume.createdAt,
      updatedAt: resume.updatedAt,
    });

    const exported = JSON.parse(JSON.stringify(await source.exportData()));

    const destination = await openServices();
    await destination.jobs.save(sampleJob('to-be-replaced'));
    await destination.importData(exported);
    expect(await destination.resumes.getAll()).toEqual([resume]);
    expect(await destination.jobs.getAll()).toEqual([job]);
    expect(await destination.settings.get('app')).toMatchObject({
      defaultResumeId: resume.id,
      preferredProvider: 'claude',
    });
    await expect(destination.resumes.get(resume.id).then((item) => item?.file.text())).resolves.toBe(
      'resume',
    );

    await expect(
      destination.importData({ ...exported, version: 99 }),
    ).rejects.toThrow('The imported local data file has an unsupported format or version.');
    expect(await destination.jobs.getAll()).toEqual([job]);
  });

  it('saves a captured job idempotently and creates one run for retried requests', async () => {
    const services = await openServices();
    const capture = {
      ...sampleJob(),
      captureMessageId: 'capture-message-1',
    };
    const firstSavedJob = await services.saveCapturedJob(capture);
    const duplicateSavedJob = await services.saveCapturedJob({
      ...capture,
      id: createRecordId('job'),
      title: 'Edited retry must not replace the first save',
    });
    expect(duplicateSavedJob.id).toBe(firstSavedJob.id);
    expect(duplicateSavedJob.title).toBe(capture.title);
    expect(await services.getCapturedJob('capture-message-1')).toEqual(firstSavedJob);

    const resume = sampleResume();
    await services.resumes.save(resume);
    const runInput = {
      idempotencyKey: 'start-message-1',
      jobId: firstSavedJob.id,
      resumeIds: [resume.id],
    };
    const created = await services.createComparisonRun(runInput);
    const retried = await services.createComparisonRun(runInput);

    expect(retried.id).toBe(created.id);
    expect(await services.runs.getAll()).toHaveLength(1);
    expect(created.status).toBe('received');
  });

  it('checks run references and persists only valid status transitions', async () => {
    const services = await openServices();
    const job = await services.saveCapturedJob({
      ...sampleJob(),
      captureMessageId: 'capture-status',
    });
    const resume = sampleResume();
    await services.resumes.save(resume);

    await expect(
      services.createComparisonRun({
        idempotencyKey: 'missing-job',
        jobId: 'missing',
        resumeIds: [resume.id],
      }),
    ).rejects.toThrow('The captured job is no longer saved in this browser.');
    await expect(
      services.createComparisonRun({
        idempotencyKey: 'missing-resume',
        jobId: job.id,
        resumeIds: ['missing-resume'],
      }),
    ).rejects.toThrow('One or more selected resumes are no longer available.');

    const run = await services.createComparisonRun({
      idempotencyKey: 'valid-run',
      jobId: job.id,
      resumeIds: [resume.id],
    });
    await expect(services.transitionRun(run.id, 'done')).rejects.toThrow(
      'cannot transition from "received" to "done"',
    );
    await expect(services.transitionRun(run.id, 'failed')).rejects.toThrow(
      'must include an error message',
    );
    const analysing = await services.transitionRun(run.id, 'analysing');
    expect(analysing.status).toBe('analysing');
    const done = await services.transitionRun(run.id, 'done');
    expect(done.status).toBe('done');
    await expect(services.transitionRun(run.id, 'failed', 'late failure')).rejects.toThrow(
      'cannot transition from "done" to "failed"',
    );
    const failedRun = await services.createComparisonRun({
      idempotencyKey: 'failed-run',
      jobId: job.id,
      resumeIds: [resume.id],
    });
    const markedFailed = await services.transitionRun(
      failedRun.id,
      'failed',
      'The selected provider is unavailable.',
    );
    expect(markedFailed).toMatchObject({
      status: 'failed',
      error: 'The selected provider is unavailable.',
    });
    expect(await services.runs.get(run.id)).toMatchObject({
      status: 'done',
      error: undefined,
    });
  });

  it('deletes every collection in one local-data operation', async () => {
    const services = await openServices();
    await services.resumes.save(sampleResume());
    await services.jobs.save(sampleJob());
    await services.runs.save({
      id: 'run-1',
      jobId: 'job-1',
      resumeIds: ['resume-1'],
      status: 'received',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await services.usage.save({
      id: 'usage-1',
      runId: 'run-1',
      provider: 'copilot',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await services.settings.save({
      id: 'app',
      defaultResumeId: null,
      preferredProvider: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await services.credentials.save({
      id: 'claude',
      format: 'talentfly-credential-v1',
      salt: 'c2FsdA==',
      iv: 'aXY=',
      ciphertext: 'c2VjcmV0',
      iterations: 310_000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await services.deleteAll();
    const exported = await services.exportData();

    expect(exported.data).toEqual({
      resumes: [],
      jobs: [],
      runs: [],
      usage: [],
      settings: [],
    });
    expect(await services.credentials.get('claude')).toBeUndefined();
  });

  it('keeps encrypted provider credentials out of exports and user-data imports', async () => {
    const services = await openServices();
    const credential = {
      id: 'claude' as const,
      format: 'talentfly-credential-v1' as const,
      salt: 'c2FsdA==',
      iv: 'aXY=',
      ciphertext: 'ZW5jcnlwdGVkLW9ubHk=',
      iterations: 310_000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await services.credentials.save(credential);
    const exported = await services.exportData();

    expect(JSON.stringify(exported)).not.toContain('credentials');
    expect(JSON.stringify(exported)).not.toContain(credential.ciphertext);
    await services.importData(exported);
    expect(await services.credentials.get('claude')).toEqual(credential);
  });
});
