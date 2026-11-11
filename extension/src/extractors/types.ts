/**
 * The reusable job model every site extractor returns. Main fields are the same for every
 * site; anything site-specific goes in `otherFields` (for example whoz.com's `Reference`).
 * `sourceUrl` is the page URL the job was read from.
 */
export interface JobCapture {
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  description: string;
  descriptionTruncated: boolean;
  otherFields?: Record<string, string>;
}

/** Extractors run inside the page, so they return an outcome instead of throwing. */
export type ExtractionOutcome =
  | { ok: true; job: JobCapture }
  | { ok: false; error: string };

export interface JobExtractor {
  id: string;
  /** Human-readable site name used in messages. */
  siteName: string;
  matches(url: string | undefined): boolean;
  /**
   * Runs in the page via `chrome.scripting.executeScript`, so it is serialized: it must be
   * fully self-contained and may not reference imports or other module-level code.
   */
  extract(maxDescriptionLength: number, timeoutMs: number): Promise<ExtractionOutcome>;
}
