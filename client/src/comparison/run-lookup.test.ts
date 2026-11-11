import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTestDatabases,
  createTestDatabase,
  seedRun,
} from '../test-helpers/local-data';
import { latestRunForUrl, normalizeJobUrl } from './run-lookup';

afterEach(cleanupTestDatabases);

describe('run lookup by page URL', () => {
  it('ignores the fragment but not the rest of the URL', () => {
    expect(normalizeJobUrl('https://app.whoz.com/jobs/1#top')).toBe('https://app.whoz.com/jobs/1');
    expect(normalizeJobUrl('https://app.whoz.com/jobs/1?tab=2')).not.toBe(
      normalizeJobUrl('https://app.whoz.com/jobs/1'),
    );
    expect(normalizeJobUrl(undefined)).toBe('');
  });

  it('finds the newest run for the page, ignoring other pages and fragments', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const url = 'https://app.whoz.com/jobs/1';
    await seedRun(services, { sourceUrl: url, done: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newest = await seedRun(services, { sourceUrl: `${url}#details` });
    await seedRun(services, { sourceUrl: 'https://app.whoz.com/jobs/2' });

    expect((await latestRunForUrl(services, `${url}#other`))?.id).toBe(newest.run.id);
    expect(await latestRunForUrl(services, 'https://app.whoz.com/jobs/999')).toBeUndefined();
  });
});
