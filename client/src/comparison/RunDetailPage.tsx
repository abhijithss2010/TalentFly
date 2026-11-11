import { useCallback, useEffect, useState } from 'react';
import { createLocalDataServices, type LocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord } from '../data/models';
import { useLocalServices } from '../data/use-local-services';
import type { CredentialVault } from '../providers/credential-vault';
import type { ProviderRegistry } from '../providers/provider-adapter';
import { downloadTextFile } from './download';
import { markdownFileName, runToMarkdown } from './markdown-export';
import { RunPanel } from './RunPanel';

interface RunDetailPageProps {
  runId: string;
  serviceFactory?: typeof createLocalDataServices;
  registry?: ProviderRegistry;
  createVault?: (services: LocalDataServices) => CredentialVault;
}

type Loaded = { run: ComparisonRunRecord; job?: JobRecord } | 'missing';

/** Only real web links become clickable; imported data is not trusted. */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * One saved comparison, addressed by run ID. Everything shown here comes from local storage:
 * opening or reloading this page never contacts an AI provider.
 */
export function RunDetailPage({
  runId,
  serviceFactory = createLocalDataServices,
  registry,
  createVault,
}: RunDetailPageProps) {
  const { services, error: openError } = useLocalServices(serviceFactory);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!services) return;
    try {
      const run = await services.runs.get(runId);
      if (!run) {
        setLoaded('missing');
        return;
      }
      setLoaded({ run, job: await services.jobs.get(run.jobId) });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The comparison could not be loaded.');
    }
  }, [services, runId]);

  useEffect(() => {
    setLoaded(null);
    void load();
  }, [load]);

  const back = <a className="text-button" href="#history">← All comparisons</a>;
  const failure = openError ?? error;
  if (failure) {
    return (
      <>
        {back}
        <p className="inbox-feedback inbox-feedback-error" role="alert">{failure}</p>
      </>
    );
  }
  if (!loaded) {
    return <p className="inbox-loading" role="status">Opening this comparison…</p>;
  }
  if (loaded === 'missing') {
    return (
      <section className="empty-state" aria-labelledby="run-missing">
        <p className="eyebrow">NOT FOUND</p>
        <h2 id="run-missing">This comparison could not be found.</h2>
        <p className="muted-copy">
          It may have been deleted from this browser. Comparisons are stored only on the device
          where they were created.
        </p>
        {back}
      </section>
    );
  }

  const { run, job } = loaded;
  const markdown = runToMarkdown(run, job);

  return (
    <div className="run-detail">
      {back}
      <header className="run-detail-header">
        <div>
          <p className="eyebrow">COMPARISON REPORT</p>
          <h2>{job?.title ?? 'Saved job'}</h2>
          <p className="muted-copy">
            {[job?.company, job?.location].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="run-detail-meta">
          <span className={`run-status run-status-${run.status}`}>{run.status}</span>
          <span className="muted-copy">
            {new Date(run.createdAt).toLocaleString()}
            {run.provider ? ` · ${run.provider}` : ''}
          </span>
        </div>
      </header>

      {run.error && <p className="inbox-feedback inbox-feedback-error" role="alert">{run.error}</p>}

      {markdown && (
        <button
          className="button button-secondary"
          onClick={() => downloadTextFile(markdownFileName(run, job), markdown, 'text/markdown')}
        >
          Export as Markdown
        </button>
      )}

      {services && (
        <RunPanel
          services={services}
          run={run}
          job={job}
          registry={registry}
          createVault={createVault}
          onChanged={() => void load()}
        />
      )}

      <section className="run-source" aria-label="Job posting">
        <h3>Job posting</h3>
        {job ? (
          <>
            {Object.entries(job.otherFields ?? {}).length > 0 && (
              <dl className="inbox-other-fields">
                {Object.entries(job.otherFields ?? {}).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {job.sourceUrl &&
              (isWebUrl(job.sourceUrl) ? (
                <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">
                  View source page
                </a>
              ) : (
                <p className="muted-copy">Source: {job.sourceUrl}</p>
              ))}
            <details>
              <summary>Job description</summary>
              <p className="inbox-job-description">{job.description}</p>
            </details>
          </>
        ) : (
          <p className="muted-copy">The captured job is no longer saved in this browser.</p>
        )}
      </section>
    </div>
  );
}
