import {
  MAX_JOB_DESCRIPTION_LENGTH as PROTOCOL_MAX_DESCRIPTION,
  MAX_JOB_FIELD_LENGTH,
  MAX_OTHER_FIELDS,
  MAX_OTHER_FIELD_KEY_LENGTH,
  MAX_OTHER_FIELD_VALUE_LENGTH,
  type CapturedJob,
} from '@talentfly/shared';
import { findExtractor, jobExtractors, type JobCapture } from './extractors';
import { UnsupportedSiteError } from './supported-site';

export type { JobCapture } from './extractors';

export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;
export const EXTRACTION_TIMEOUT_MS = 6_000;

/** Reads the job from the active tab using the extractor registered for its site. */
export async function captureCurrentTab(): Promise<JobCapture> {
  if (!globalThis.chrome?.tabs || !globalThis.chrome.scripting) {
    throw new Error('Job extraction is only available in the installed Chrome extension.');
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id !== 'number') {
    throw new Error('No active browser tab is available.');
  }

  const extractor = findExtractor(activeTab.url);
  if (!extractor) {
    throw new UnsupportedSiteError(jobExtractors.map((candidate) => candidate.siteName));
  }

  let outcome;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: extractor.extract,
      args: [MAX_JOB_DESCRIPTION_LENGTH, EXTRACTION_TIMEOUT_MS],
    });
    outcome = injection?.result;
  } catch {
    throw new Error(
      `This page does not allow reading. Reload the ${extractor.siteName} job page and reopen the extension.`,
    );
  }
  if (!outcome) {
    throw new Error('The active page did not return any job details.');
  }
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  // The URL always comes from the tab itself, not from page content.
  return { ...outcome.job, sourceUrl: activeTab.url ?? outcome.job.sourceUrl };
}

/**
 * Turns an extracted job into the exact shape the protocol accepts: trims text, clamps every
 * field to the protocol limits, and drops empty or excess extras. Extractors should already
 * respect these limits; this is the last line of defense before a message is built.
 */
export function toCapturedJob(job: JobCapture): CapturedJob {
  const clamp = (value: string, max: number) => value.trim().slice(0, max).trim();
  const extras = Object.entries(job.otherFields ?? {})
    .map(([key, value]) => [
      clamp(key, MAX_OTHER_FIELD_KEY_LENGTH),
      clamp(value, MAX_OTHER_FIELD_VALUE_LENGTH),
    ])
    .filter(([key, value]) => key && value)
    .slice(0, MAX_OTHER_FIELDS);

  return {
    title: clamp(job.title, MAX_JOB_FIELD_LENGTH),
    company: clamp(job.company, MAX_JOB_FIELD_LENGTH),
    location: clamp(job.location, MAX_JOB_FIELD_LENGTH),
    sourceUrl: job.sourceUrl,
    description: clamp(job.description, PROTOCOL_MAX_DESCRIPTION),
    ...(extras.length > 0 ? { otherFields: Object.fromEntries(extras) } : {}),
  };
}
