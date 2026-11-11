import { describe, expect, it } from 'vitest';
import { urlIsOnDomain } from '../src/supported-site';

const isSupportedJobUrl = (url: string | undefined) => urlIsOnDomain(url, 'whoz.com');

describe('supported job site', () => {
  it.each([
    'https://whoz.com/jobs/1',
    'https://www.whoz.com/jobs/1',
    'https://app.whoz.com/en/job?id=2',
    'https://WHOZ.COM/',
  ])('accepts %s', (url) => {
    expect(isSupportedJobUrl(url)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'not a url',
    'http://whoz.com/jobs/1',
    'https://notwhoz.com/jobs/1',
    'https://whoz.com.evil.test/jobs/1',
    'https://evil.test/whoz.com',
    'https://user@evil.test/?u=whoz.com',
    'chrome://extensions',
    'file:///whoz.com/index.html',
  ])('rejects %s', (url) => {
    expect(isSupportedJobUrl(url)).toBe(false);
  });
});
