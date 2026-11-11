import { describe, expect, it, vi } from 'vitest';
import { fetchServerBuildInfo, parseBuildInfo, parseExtensionBuildInfo } from './diagnostics';

const serverBuild = {
  version: '0.1.0',
  commit: 'abc123',
  builtAt: '2026-11-11T00:00:00.000Z',
};

describe('build diagnostics', () => {
  it('accepts a version, commit, and timestamp from the server', () => {
    expect(parseBuildInfo(serverBuild)).toEqual(serverBuild);
  });

  it('rejects malformed server build information', () => {
    expect(() => parseBuildInfo({ version: '0.1.0' })).toThrow(
      'The server returned invalid build information.',
    );
  });

  it('fetches and validates the server version response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(serverBuild)));

    await expect(fetchServerBuildInfo('https://api.example/meta/version', fetcher)).resolves.toEqual(
      serverBuild,
    );
    expect(fetcher).toHaveBeenCalledWith('https://api.example/meta/version', {
      headers: { Accept: 'application/json' },
    });
  });

  it('reports HTTP and network failures explicitly', async () => {
    await expect(
      fetchServerBuildInfo(
        'https://api.example/meta/version',
        async () => new Response('', { status: 503 }),
      ),
    ).rejects.toThrow('The server version endpoint returned HTTP 503.');

    await expect(
      fetchServerBuildInfo('https://api.example/meta/version', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('The server version endpoint could not be reached.');
  });

  it('parses extension build metadata only when all fields are present', () => {
    const query = new URLSearchParams({
      extensionVersion: serverBuild.version,
      extensionCommit: serverBuild.commit,
      extensionBuiltAt: serverBuild.builtAt,
    });

    expect(parseExtensionBuildInfo(`?${query}`)).toEqual(serverBuild);
    expect(parseExtensionBuildInfo('?extensionVersion=0.1.0')).toBeNull();
  });
});
