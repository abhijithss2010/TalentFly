import { whozExtractor } from './whoz';
import type { JobExtractor } from './types';

/** Add a new site by creating its extractor file and listing it here. */
export const jobExtractors: readonly JobExtractor[] = [whozExtractor];

export function findExtractor(url: string | undefined): JobExtractor | undefined {
  return jobExtractors.find((extractor) => extractor.matches(url));
}

export type { ExtractionOutcome, JobCapture, JobExtractor } from './types';
