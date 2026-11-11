export class UnsupportedSiteError extends Error {
  constructor(siteNames: string[]) {
    super(`Open a job posting on ${siteNames.join(' or ')} to extract its details.`);
    this.name = 'UnsupportedSiteError';
  }
}

/** True only for HTTPS pages on `domain` or one of its real subdomains. */
export function urlIsOnDomain(url: string | undefined, domain: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
