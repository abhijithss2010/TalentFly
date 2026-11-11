import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureCurrentTab,
  toCapturedJob,
  EXTRACTION_TIMEOUT_MS,
  MAX_JOB_DESCRIPTION_LENGTH,
} from '../src/job-capture';
import { whozExtractor } from '../src/extractors/whoz';
import { findExtractor, jobExtractors } from '../src/extractors';

const job = {
  title: 'Engineer',
  company: '',
  location: 'Paris',
  sourceUrl: 'https://page-reported.example/',
  description: 'Build reliable systems.',
  descriptionTruncated: false,
  otherFields: { Reference: 'R-1' },
};

function stubChrome(url: string | undefined, executeScript: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([{ id: 42, url }]) },
    scripting: { executeScript },
  });
}

describe('job capture dispatcher', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers whoz.com and resolves extractors from the tab URL', () => {
    expect(jobExtractors.map((extractor) => extractor.id)).toEqual(['whoz']);
    expect(findExtractor('https://app.whoz.com/jobs/1')).toBe(whozExtractor);
    expect(findExtractor('https://linkedin.com/jobs/1')).toBeUndefined();
  });

  it('injects the whoz extractor into the active tab and uses the tab URL as the job URL', async () => {
    const executeScript = vi.fn().mockResolvedValue([{ result: { ok: true, job } }]);
    stubChrome('https://app.whoz.com/jobs/1?x=1', executeScript);

    await expect(captureCurrentTab()).resolves.toEqual({
      ...job,
      sourceUrl: 'https://app.whoz.com/jobs/1?x=1',
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: whozExtractor.extract,
      args: [MAX_JOB_DESCRIPTION_LENGTH, EXTRACTION_TIMEOUT_MS],
    });
  });

  it('surfaces extractor errors from the page', async () => {
    stubChrome(
      'https://whoz.com/jobs/1',
      vi.fn().mockResolvedValue([{ result: { ok: false, error: 'The job title was not found on this whoz.com page.' } }]),
    );
    await expect(captureCurrentTab()).rejects.toThrow('The job title was not found');
  });

  it('returns an explicit error when the page cannot be inspected', async () => {
    stubChrome('https://whoz.com/jobs/1', vi.fn().mockRejectedValue(new Error('Cannot access')));
    await expect(captureCurrentTab()).rejects.toThrow('This page does not allow reading.');
  });

  it('never injects a script on unsupported pages', async () => {
    const executeScript = vi.fn();
    stubChrome('https://example.com/jobs/1', executeScript);
    await expect(captureCurrentTab()).rejects.toThrow('Open a job posting on whoz.com');
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('normalizes a job to the protocol limits before it is sent', () => {
    const normalized = toCapturedJob({
      title: `  ${'T'.repeat(300)}  `,
      company: '',
      location: ' Paris ',
      sourceUrl: 'https://whoz.com/jobs/1',
      description: `  ${'d'.repeat(25_000)}`,
      descriptionTruncated: true,
      otherFields: { Reference: '  R-1  ', Empty: '   ', '': 'no key' },
    });

    expect(normalized.title).toHaveLength(200);
    expect(normalized.location).toBe('Paris');
    expect(normalized.description).toHaveLength(20_000);
    expect(normalized.otherFields).toEqual({ Reference: 'R-1' });
    expect(normalized).not.toHaveProperty('descriptionTruncated');
    expect(
      toCapturedJob({ ...job, otherFields: { Empty: '' } }),
    ).not.toHaveProperty('otherFields');
  });
});
