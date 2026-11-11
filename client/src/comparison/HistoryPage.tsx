import { useEffect, useState } from 'react';
import { createLocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord, ResumeRecord, UsageRecord } from '../data/models';
import { useLocalServices } from '../data/use-local-services';
import { parseRunResult } from './run-result';

interface HistoryData {
  runs: ComparisonRunRecord[];
  jobs: Map<string, JobRecord>;
  resumes: Map<string, ResumeRecord>;
  usage: UsageRecord[];
}

const MAX_USAGE_ROWS = 50;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function number(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString();
}

export function HistoryPage({
  serviceFactory = createLocalDataServices,
}: {
  serviceFactory?: typeof createLocalDataServices;
}) {
  const { services, error: openError } = useLocalServices(serviceFactory);
  const [data, setData] = useState<HistoryData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!services) return;
    let active = true;
    Promise.all([
      services.runs.getAll(),
      services.jobs.getAll(),
      services.resumes.getAll(),
      services.usage.getAll(),
    ])
      .then(([runs, jobs, resumes, usage]) => {
        if (!active) return;
        setData({
          runs: runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          jobs: new Map(jobs.map((job) => [job.id, job])),
          resumes: new Map(resumes.map((resume) => [resume.id, resume])),
          usage: usage.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        });
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'History could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [services]);

  const error = openError ?? loadError;
  if (error) {
    return <p className="inbox-feedback inbox-feedback-error" role="alert">{error}</p>;
  }
  if (!data) {
    return <p className="inbox-loading" role="status">Opening your comparison history…</p>;
  }

  const totals = new Map<string, { input: number; output: number; responses: number }>();
  for (const record of data.usage) {
    const current = totals.get(record.provider) ?? { input: 0, output: 0, responses: 0 };
    current.input += record.inputTokens ?? 0;
    current.output += record.outputTokens ?? 0;
    current.responses += 1;
    totals.set(record.provider, current);
  }

  return (
    <div className="history-page">
      {data.runs.length === 0 ? (
        <section className="empty-state" aria-labelledby="history-empty">
          <div className="empty-state-icon" aria-hidden="true">C</div>
          <p className="eyebrow">YOUR PROGRESS</p>
          <h2 id="history-empty">No comparisons yet.</h2>
          <p className="muted-copy">
            Compare a captured job with one of your resumes and the saved report will appear here.
          </p>
        </section>
      ) : (
        <section aria-label="Comparison history">
          <ul className="history-list">
            {data.runs.map((run) => {
              const job = data.jobs.get(run.jobId);
              const result = parseRunResult(run.result);
              const names =
                result && result.reports.length > 0
                  ? result.reports.map((entry) => entry.resumeName)
                  : run.resumeIds.map((id) => data.resumes.get(id)?.name ?? 'Deleted resume');
              const best = result?.reports.length
                ? Math.max(...result.reports.map((entry) => entry.report.matchScore))
                : null;
              return (
                <li key={run.id} className="history-item">
                  <a className="history-link" href={`#history/${run.id}`}>
                    <strong>{job?.title ?? 'Saved job'}</strong>
                    <span>{[job?.company, job?.location].filter(Boolean).join(' · ')}</span>
                  </a>
                  <span className="muted-copy">{names.join(', ')}</span>
                  <span className="muted-copy">{formatDate(run.createdAt)}</span>
                  <span className={`run-status run-status-${run.status}`}>{run.status}</span>
                  {best !== null && <span className="history-score">{best}/100</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="usage-history" aria-label="Local usage history">
        <h3>Usage on this device</h3>
        <p className="muted-copy">
          Token counts reported by the provider for your own API key. Costs are not calculated
          because providers report tokens, not prices; check your provider account for billing.
        </p>
        {data.usage.length === 0 ? (
          <p className="muted-copy">No provider requests have been made yet.</p>
        ) : (
          <>
            <ul className="usage-totals">
              {[...totals].map(([provider, total]) => (
                <li key={provider}>
                  <strong>{provider}</strong>: {total.responses.toLocaleString()} responses ·{' '}
                  {total.input.toLocaleString()} input · {total.output.toLocaleString()} output tokens
                </li>
              ))}
            </ul>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Provider</th>
                  <th>Input tokens</th>
                  <th>Output tokens</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.slice(0, MAX_USAGE_ROWS).map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.createdAt)}</td>
                    <td>{record.provider}</td>
                    <td>{number(record.inputTokens)}</td>
                    <td>{number(record.outputTokens)}</td>
                    <td>
                      {data.runs.some((run) => run.id === record.runId) ? (
                        <a href={`#history/${record.runId}`}>Open</a>
                      ) : (
                        'Deleted'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.usage.length > MAX_USAGE_ROWS && (
              <p className="muted-copy">
                Showing the latest {MAX_USAGE_ROWS} of {data.usage.length} responses. Totals above
                include all of them.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
