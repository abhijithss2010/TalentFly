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
    fileName: 'resume.pdf',
    mimeType: 'application/pdf',
    fileSize: 6,
    file: new Blob(['resume'], { type: 'application/pdf' }),
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

    await services.deleteAll();
    const exported = await services.exportData();

    expect(exported.data).toEqual({
      resumes: [],
      jobs: [],
      runs: [],
      usage: [],
      settings: [],
    });
  });
});
