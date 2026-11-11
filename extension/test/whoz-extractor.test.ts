// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractWhozJob, whozExtractor } from '../src/extractors/whoz';

function page(html: string): void {
  document.body.innerHTML = html;
  window.history.replaceState(null, '', '/jobs/42');
}

const FULL_PAGE = `
  <header>Whoz navigation</header>
  <main>
    <h2 class="title">Senior Platform Engineer</h2>
    <ul class="locations-list"><li>Paris</li><li>Remote</li></ul>
    <section>
      <h4>Reference</h4>
      <div>REF-2026-001</div>
    </section>
    <section>
      <h4>Description</h4>
      <div>
        <p>Own the deployment platform.</p>
        <p>Mentor engineers across teams.</p>
      </div>
    </section>
  </main>`;

describe('whoz.com extractor', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('only matches whoz.com and its real subdomains over https', () => {
    expect(whozExtractor.matches('https://whoz.com/x')).toBe(true);
    expect(whozExtractor.matches('https://app.whoz.com/x')).toBe(true);
    expect(whozExtractor.matches('http://whoz.com/x')).toBe(false);
    expect(whozExtractor.matches('https://notwhoz.com/x')).toBe(false);
    expect(whozExtractor.matches('https://whoz.com.evil.test/x')).toBe(false);
  });

  it('reads title, location, reference, description, and the page URL', async () => {
    page(FULL_PAGE);
    const outcome = await extractWhozJob(20_000, 0);

    expect(outcome).toEqual({
      ok: true,
      job: {
        title: 'Senior Platform Engineer',
        company: '',
        location: 'Paris, Remote',
        sourceUrl: window.location.href,
        description: 'Own the deployment platform.\n\nMentor engineers across teams.',
        descriptionTruncated: false,
        otherFields: { Reference: 'REF-2026-001' },
      },
    });
  });

  it('accepts a trailing colon on labels and a single-text location', async () => {
    page(`
      <h2 class="title">Data Engineer</h2>
      <div class="locations-list">Lyon</div>
      <div><span>Reference:</span></div><div>R-9</div>
      <div><strong>Description:</strong></div><div>Build pipelines.</div>`);
    const outcome = await extractWhozJob(20_000, 0);
    expect(outcome.ok && outcome.job).toMatchObject({
      title: 'Data Engineer',
      location: 'Lyon',
      description: 'Build pipelines.',
      otherFields: { Reference: 'R-9' },
    });
  });

  it('omits Reference when the page has none and leaves location empty', async () => {
    page(`<h2 class="title">Engineer</h2><h4>Description</h4><div>Do the work.</div>`);
    const outcome = await extractWhozJob(20_000, 0);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.job.location).toBe('');
      expect(outcome.job.otherFields).toBeUndefined();
    }
  });

  it('ignores hidden elements and a hidden duplicate label', async () => {
    page(`
      <h2 class="title" style="display:none">Hidden title</h2>
      <h2 class="title">Visible title</h2>
      <h4 style="display:none">Description</h4><div>Wrong text</div>
      <h4>Description</h4><div>Right text <span hidden>secret</span></div>`);
    const outcome = await extractWhozJob(20_000, 0);
    expect(outcome.ok && outcome.job).toMatchObject({
      title: 'Visible title',
      description: 'Right text',
    });
  });

  it('truncates a long description and flags it', async () => {
    page(`<h2 class="title">T</h2><h4>Description</h4><p>${'word '.repeat(100)}</p>`);
    const outcome = await extractWhozJob(50, 0);
    expect(outcome.ok && outcome.job.description.length).toBeLessThanOrEqual(50);
    expect(outcome.ok && outcome.job.descriptionTruncated).toBe(true);
  });

  it('waits for the single-page app to render, then succeeds', async () => {
    page('<main></main>');
    setTimeout(() => page(FULL_PAGE), 300);
    const outcome = await extractWhozJob(20_000, 3_000);
    expect(outcome.ok && outcome.job.title).toBe('Senior Platform Engineer');
  });

  it('reports exactly which required field is missing', async () => {
    page('<h4>Description</h4><div>Text only.</div>');
    expect(await extractWhozJob(20_000, 0)).toEqual({
      ok: false,
      error: 'The job title was not found on this whoz.com page.',
    });
    page('<h2 class="title">Only a title</h2>');
    expect(await extractWhozJob(20_000, 0)).toEqual({
      ok: false,
      error: 'The job description was not found on this whoz.com page.',
    });
  });
});
