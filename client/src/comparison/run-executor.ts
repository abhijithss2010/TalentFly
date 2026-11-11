import { createRecordId, type LocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord, ProviderId, UsageRecord } from '../data/models';
import type { CredentialVault } from '../providers/credential-vault';
import type { ProviderRegistry, ProviderUsage } from '../providers/provider-adapter';
import {
  resolveProviderSelection,
  runConfiguredComparison,
} from './comparison-service';
import { ComparisonOutputError } from './gap-report';
import { buildComparisonPrompt, type ComparisonJobInput } from './prompt';
import type { RunFailureEntry, RunReportEntry, RunResult } from './run-result';

export interface RunProgress {
  /** 1-based position of the resume being compared. */
  index: number;
  total: number;
  resumeName: string;
}

export function jobToComparisonInput(job: JobRecord): ComparisonJobInput {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
    otherFields: job.otherFields,
  };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The comparison failed unexpectedly.';
}

async function recordUsage(
  services: LocalDataServices,
  runId: string,
  provider: ProviderId,
  usage: ProviderUsage | undefined,
): Promise<void> {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
    return;
  }
  const now = new Date().toISOString();
  const record: UsageRecord = {
    id: createRecordId('usage'),
    runId,
    provider,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    // Providers return token counts but not a price, so no cost is estimated here.
    createdAt: now,
    updatedAt: now,
  };
  await services.usage.save(record);
}

/**
 * Runs a `received` comparison with the provider chosen in settings and saves the result.
 *
 * Everything that can be checked up front is checked before the run changes state, so a
 * missing resume, empty text, unconfigured provider, or locked key leaves the run untouched
 * and retryable. After that: received → analysing → done (at least one report) or failed.
 */
export async function executeRun(input: {
  services: LocalDataServices;
  runId: string;
  registry: ProviderRegistry;
  vault: CredentialVault;
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
}): Promise<ComparisonRunRecord> {
  const { services, runId, registry, vault, signal, onProgress } = input;

  const run = await services.runs.get(runId);
  if (!run) throw new Error('The comparison run could not be found.');
  if (run.status !== 'received') {
    throw new Error(`This comparison run is already ${run.status}.`);
  }
  const job = await services.jobs.get(run.jobId);
  if (!job) throw new Error('The captured job is no longer saved in this browser.');

  const resumes = await Promise.all(run.resumeIds.map((id) => services.resumes.get(id)));
  const available = resumes.filter((resume): resume is NonNullable<typeof resume> => Boolean(resume));
  if (available.length !== resumes.length) {
    throw new Error('One or more selected resumes are no longer available.');
  }

  const settings = (await services.settings.get('app')) ?? { preferredProvider: null };
  const { providerId } = resolveProviderSelection(settings, registry);
  if (!vault.isUnlocked(providerId)) {
    throw new Error('Unlock the provider with your passphrase before running a comparison.');
  }
  const jobInput = jobToComparisonInput(job);
  for (const resume of available) {
    buildComparisonPrompt(jobInput, { name: resume.name, text: resume.extractedText });
  }

  await services.transitionRun(run.id, 'analysing', undefined, { provider: providerId });

  const reports: RunReportEntry[] = [];
  const failures: RunFailureEntry[] = [];
  for (const [position, resume] of available.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ index: position + 1, total: available.length, resumeName: resume.name });
    try {
      const result = await runConfiguredComparison({
        settings,
        registry,
        vault,
        job: jobInput,
        resume: { name: resume.name, text: resume.extractedText },
        signal,
      });
      await recordUsage(services, run.id, providerId, result.usage);
      reports.push({
        resumeId: resume.id,
        resumeName: resume.name,
        model: result.model,
        report: result.report,
        usage: result.usage,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ComparisonOutputError) {
        // The provider answered (and charged for it) even though the answer was unusable.
        await recordUsage(services, run.id, providerId, error.usage);
      }
      failures.push({ resumeId: resume.id, resumeName: resume.name, error: messageFrom(error) });
    }
  }

  const result: RunResult = { version: 1, reports, failures };
  const savedResult = result as unknown as Record<string, unknown>;
  if (signal?.aborted) {
    return services.transitionRun(run.id, 'failed', 'Cancelled before it finished.', {
      result: savedResult,
    });
  }
  if (reports.length > 0) {
    return services.transitionRun(run.id, 'done', undefined, { result: savedResult });
  }
  return services.transitionRun(
    run.id,
    'failed',
    failures[0]?.error ?? 'The comparison produced no report.',
    { result: savedResult },
  );
}

/** Marks an `analysing` run that nothing is working on as failed, so it can be retried. */
export async function resetInterruptedRun(
  services: LocalDataServices,
  runId: string,
): Promise<ComparisonRunRecord> {
  await services.transitionRun(runId, 'failed', 'Interrupted before it finished.');
  return retryRun(services, runId);
}

/** Moves a failed run back to `received` so it can be reviewed and sent again. */
export function retryRun(
  services: LocalDataServices,
  runId: string,
): Promise<ComparisonRunRecord> {
  return services.transitionRun(runId, 'received');
}
