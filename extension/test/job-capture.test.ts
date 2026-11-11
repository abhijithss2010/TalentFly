// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureCurrentTab,
  extractJobPostingFromPage,
  MAX_JOB_DESCRIPTION_LENGTH,
} from '../src/job-capture';

describe('job posting extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    document.documentElement.innerHTML = '<head><title>Listing | Jobs</title></head><body></body>';
    window.history.replaceState(null, '', '/jobs/role-123');
  });

  it('extracts visible title, company, location, description, and source URL', () => {
    document.body.innerHTML = `
      <nav>Home Browse Companies</nav>
      <main>
        <h1>Frontend Engineer</h1>
        <div data-testid="company-name">Example Co</div>
        <div data-testid="job-location">Remote, US</div>
        <section data-testid="job-description">
          <p>Build accessible interfaces used by customers.</p>
          <p>Collaborate with product and design teams.</p>
          <button>Apply now</button>
          <div hidden>Internal tracking text that is not visible.</div>
          <div aria-hidden="true">Screenreader-excluded content.</div>
        </section>
      </main>
      <footer>Privacy Terms</footer>
    `;

    expect(extractJobPostingFromPage()).toEqual({
      title: 'Frontend Engineer',
      company: 'Example Co',
      location: 'Remote, US',
      sourceUrl: 'http://localhost:3000/jobs/role-123',
      description:
        'Build accessible interfaces used by customers.\n\nCollaborate with product and design teams.',
      descriptionTruncated: false,
    });
  });

  it('uses a generic main-content fallback without navigation or hidden noise', () => {
    document.body.innerHTML = `
      <nav>Home Search Saved jobs</nav>
      <main>
        <h1>Platform Engineer</h1>
        <p>Own reliable deployment systems for our growing engineering organization.</p>
        <p>Partner with teams to improve developer workflows and service health.</p>
        <div style="display: none">Do not capture hidden compensation notes.</div>
      </main>
      <footer>Terms and conditions</footer>
    `;

    const capture = extractJobPostingFromPage();

    expect(capture.title).toBe('Platform Engineer');
    expect(capture.description).toContain('Own reliable deployment systems');
    expect(capture.description).not.toContain('Home Search');
    expect(capture.description).not.toContain('hidden compensation');
    expect(capture.description).not.toContain('Terms and conditions');
  });

  it('rejects empty and title-only pages instead of treating surrounding noise as a description', () => {
    document.body.innerHTML = '';
    document.title = '';
    expect(() => extractJobPostingFromPage()).toThrow(
      'No readable job details were found on this page.',
    );

    document.body.innerHTML = '<main><h1>Senior Product Designer</h1></main>';
    expect(() => extractJobPostingFromPage()).toThrow(
      'No visible job description was found on this page.',
    );
  });

  it('truncates very long descriptions to the preview size limit', () => {
    document.body.innerHTML = `
      <main>
        <h1>Technical Writer</h1>
        <section data-testid="job-description"><p>${'Write clear product documentation. '.repeat(900)}</p></section>
      </main>
    `;

    const capture = extractJobPostingFromPage();

    expect(capture.description).toHaveLength(MAX_JOB_DESCRIPTION_LENGTH);
    expect(capture.descriptionTruncated).toBe(true);
  });

  it('injects only into the user-selected active tab after capture is requested', async () => {
    const capture = {
      title: 'Engineer',
      company: 'Example',
      location: 'Remote',
      sourceUrl: 'https://jobs.example/engineer',
      description: 'Build reliable systems for customers and teams.',
      descriptionTruncated: false,
    };
    const chromeApi = {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]) },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: capture }]),
      },
    };
    vi.stubGlobal('chrome', chromeApi);

    await expect(captureCurrentTab()).resolves.toEqual(capture);
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: extractJobPostingFromPage,
      args: [MAX_JOB_DESCRIPTION_LENGTH],
    });
  });

  it('returns an explicit error when the active page cannot be inspected', async () => {
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]) },
      scripting: {
        executeScript: vi.fn().mockRejectedValue(new Error('Cannot access this page')),
      },
    });

    await expect(captureCurrentTab()).rejects.toThrow(
      'This page does not allow capture. Open a regular webpage and try again.',
    );
  });
});
