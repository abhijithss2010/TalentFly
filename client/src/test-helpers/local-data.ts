import { Blob as NodeBlob } from 'node:buffer';
import { indexedDB } from 'fake-indexeddb';
import { vi } from 'vitest';
import {
  createLocalDataServices,
  createRecordId,
  type LocalDataServices,
} from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord } from '../data/models';
import type { RunResult } from '../comparison/run-result';

const databaseNames: string[] = [];
const opened: LocalDataServices[] = [];

/** A fresh in-memory database; `factory` can be passed straight to a component. */
export function createTestDatabase() {
  vi.stubGlobal('Blob', NodeBlob);
  const databaseName = `test-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  const factory = async () => {
    const services = await createLocalDataServices({ databaseName, indexedDB });
    opened.push(services);
    return services;
  };
  return { factory, databaseName };
}

export async function cleanupTestDatabases(): Promise<void> {
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
  vi.unstubAllGlobals();
}

export const sampleResult = (resumeId: string): RunResult => ({
  version: 1,
  reports: [
    {
      resumeId,
      resumeName: 'Platform resume',
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 1200, outputTokens: 300 },
      completedAt: '2026-11-12T10:00:00.000Z',
      report: {
        matchScore: 81,
        summary: 'Strong infrastructure background.',
        requirements: [
          {
            requirement: 'Kubernetes experience',
            status: 'met',
            evidence: 'Ran Kubernetes clusters',
            evidenceVerified: true,
            note: 'Direct match',
          },
          {
            requirement: 'Terraform',
            status: 'missing',
            evidence: '',
            evidenceVerified: false,
            note: 'Not mentioned',
          },
        ],
        keywordGaps: ['Terraform'],
        suggestions: [
          { section: 'Skills', suggestion: 'Mention Terraform if you use it.', evidence: '', unverified: true },
          { section: 'Experience', suggestion: 'Lead with cluster scale.', evidence: 'Ran Kubernetes clusters', unverified: false },
        ],
      },
    },
  ],
  failures: [],
});

export async function seedRun(
  services: LocalDataServices,
  options: { done?: boolean; title?: string; sourceUrl?: string } = {},
): Promise<{ run: ComparisonRunRecord; job: JobRecord; resumeId: string }> {
  const { done = true, title = 'Platform Engineer', sourceUrl = 'https://app.whoz.com/jobs/1' } = options;
  const now = new Date().toISOString();
  const job = await services.saveCapturedJob({
    id: createRecordId('job'),
    captureMessageId: `capture-${crypto.randomUUID()}`,
    title,
    company: 'Example Co',
    location: 'Paris, Remote',
    sourceUrl,
    description: 'Own the deployment platform.',
    otherFields: { Reference: 'REF-42' },
    createdAt: now,
    updatedAt: now,
  });
  const resumeId = createRecordId('resume');
  await services.resumes.save({
    id: resumeId,
    name: 'Platform resume',
    fileName: 'platform.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 1,
    file: new Blob(['x']),
    extractedText: 'Ran Kubernetes clusters for four years.',
    createdAt: now,
    updatedAt: now,
  });
  let run = await services.createComparisonRun({
    idempotencyKey: `seed-${crypto.randomUUID()}`,
    jobId: job.id,
    resumeIds: [resumeId],
  });
  if (done) {
    await services.transitionRun(run.id, 'analysing', undefined, { provider: 'claude' });
    run = await services.transitionRun(run.id, 'done', undefined, {
      result: sampleResult(resumeId) as unknown as Record<string, unknown>,
    });
    await services.usage.save({
      id: createRecordId('usage'),
      runId: run.id,
      provider: 'claude',
      inputTokens: 1200,
      outputTokens: 300,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { run, job, resumeId };
}
