import type { BuildInfo } from './build-info';

export function parseBuildInfo(value: unknown): BuildInfo {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    !('commit' in value) ||
    !('builtAt' in value) ||
    typeof value.version !== 'string' ||
    typeof value.commit !== 'string' ||
    typeof value.builtAt !== 'string'
  ) {
    throw new Error('The server returned invalid build information.');
  }

  return {
    version: value.version,
    commit: value.commit,
    builtAt: value.builtAt,
  };
}

export async function fetchServerBuildInfo(
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<BuildInfo> {
  let response: Response;
  try {
    response = await fetcher(endpoint, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('The server version endpoint could not be reached.');
  }

  if (!response.ok) {
    throw new Error(`The server version endpoint returned HTTP ${response.status}.`);
  }

  return parseBuildInfo(await response.json());
}

export function parseExtensionBuildInfo(search: string): BuildInfo | null {
  const params = new URLSearchParams(search);
  const version = params.get('extensionVersion');
  const commit = params.get('extensionCommit');
  const builtAt = params.get('extensionBuiltAt');

  if (!version && !commit && !builtAt) return null;
  if (!version || !commit || !builtAt) return null;

  try {
    return parseBuildInfo({ version, commit, builtAt });
  } catch {
    return null;
  }
}
