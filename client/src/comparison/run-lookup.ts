import type { LocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord } from '../data/models';

/** Compares page URLs without their `#fragment`, which changes as a page is used. */
export function normalizeJobUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The newest run for any saved job that was read from this page URL. */
export async function latestRunForUrl(
  services: LocalDataServices,
  sourceUrl: string,
): Promise<ComparisonRunRecord | undefined> {
  const wanted = normalizeJobUrl(sourceUrl);
  const [jobs, runs] = await Promise.all([services.jobs.getAll(), services.runs.getAll()]);
  const jobIds = new Set(
    jobs.filter((job) => normalizeJobUrl(job.sourceUrl) === wanted).map((job) => job.id),
  );
  return runs
    .filter((run) => jobIds.has(run.jobId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}
