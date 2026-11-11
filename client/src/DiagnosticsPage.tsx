import { useEffect, useState } from 'react';
import { BUILD_INFO } from './build-info';
import { fetchServerBuildInfo, parseExtensionBuildInfo } from './diagnostics';

function BuildDetails({ build }: { build: { version: string; commit: string; builtAt: string } }) {
  return (
    <dl className="build-details">
      <div>
        <dt>Version</dt>
        <dd>{build.version}</dd>
      </div>
      <div>
        <dt>Commit</dt>
        <dd>
          <code>{build.commit}</code>
        </dd>
      </div>
      <div>
        <dt>Built at</dt>
        <dd>{build.builtAt}</dd>
      </div>
    </dl>
  );
}

export function DiagnosticsPage() {
  const [serverBuild, setServerBuild] = useState<Awaited<
    ReturnType<typeof fetchServerBuildInfo>
  > | null>(null);
  const [serverError, setServerError] = useState('Checking server build information…');
  const apiEndpoint = import.meta.env.VITE_TALENTFLY_API_URL?.trim();
  const extensionBuild = parseExtensionBuildInfo(window.location.search);

  useEffect(() => {
    let active = true;
    if (!apiEndpoint) {
      setServerBuild(null);
      setServerError('Not configured. Set VITE_TALENTFLY_API_URL to the version endpoint.');
      return () => {
        active = false;
      };
    }

    setServerError('Checking server build information…');
    void fetchServerBuildInfo(apiEndpoint).then(
      (build) => {
        if (active) {
          setServerBuild(build);
          setServerError('');
        }
      },
      (error: unknown) => {
        if (active) {
          setServerBuild(null);
          setServerError(
            error instanceof Error ? error.message : 'The server version endpoint failed.',
          );
        }
      },
    );

    return () => {
      active = false;
    };
  }, [apiEndpoint]);

  return (
    <section className="diagnostics-page" aria-label="Build diagnostics">
      <p className="diagnostics-intro">
        Build identities help distinguish independently deployed PWA, API, and extension
        versions. No resume or comparison data is sent for these checks.
      </p>
      <div className="diagnostics-grid">
        <article className="diagnostic-card">
          <h2>PWA build</h2>
          <BuildDetails build={BUILD_INFO} />
        </article>
        <article className="diagnostic-card">
          <h2>Server build</h2>
          {serverBuild ? (
            <BuildDetails build={serverBuild} />
          ) : (
            <p className="diagnostic-status" role="status">
              {serverError}
            </p>
          )}
        </article>
        <article className="diagnostic-card">
          <h2>Chrome extension</h2>
          {extensionBuild ? (
            <>
              <p className="diagnostic-source">Reported when TalentFly was opened from the extension.</p>
              <BuildDetails build={extensionBuild} />
            </>
          ) : (
            <p className="diagnostic-status" role="status">
              No extension build has been reported in this visit. Open TalentFly using the
              extension popup to report its installed version.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
