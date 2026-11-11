import { useEffect, useState } from 'react';
import { createLocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord, UsageRecord } from '../data/models';
import { useLocalServices } from '../data/use-local-services';

interface UsageData {
  runs: ComparisonRunRecord[];
  jobs: Map<string, JobRecord>;
  usage: UsageRecord[];
}

interface Tokens {
  responses: number;
  input: number;
  output: number;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function add(total: Tokens, record: UsageRecord): Tokens {
  return {
    responses: total.responses + 1,
    input: total.input + (record.inputTokens ?? 0),
    output: total.output + (record.outputTokens ?? 0),
  };
}

const EMPTY: Tokens = { responses: 0, input: 0, output: 0 };

/** Token usage reported by the provider, shown per comparison run. */
export function UsagePage({
  serviceFactory = createLocalDataServices,
}: {
  serviceFactory?: typeof createLocalDataServices;
}) {
  const { services, error: openError } = useLocalServices(serviceFactory);
  const [data, setData] = useState<UsageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!services) return;
    let active = true;
    Promise.all([services.runs.getAll(), services.jobs.getAll(), services.usage.getAll()])
      .then(([runs, jobs, usage]) => {
        if (!active) return;
        setData({
          runs: runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          jobs: new Map(jobs.map((job) => [job.id, job])),
          usage,
        });
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Usage could not be loaded.');
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
    return <p className="inbox-loading" role="status">Opening your usage…</p>;
  }

  const byRun = new Map<string, UsageRecord[]>();
  for (const record of data.usage) {
    byRun.set(record.runId, [...(byRun.get(record.runId) ?? []), record]);
  }
  const knownRunIds = new Set(data.runs.map((run) => run.id));
  const orphaned = data.usage.filter((record) => !knownRunIds.has(record.runId));
  const totals = new Map<string, Tokens>();
  for (const record of data.usage) {
    totals.set(record.provider, add(totals.get(record.provider) ?? EMPTY, record));
  }
  const rows = data.runs.filter((run) => byRun.has(run.id));

  return (
    <div className="usage-page">
      <p className="muted-copy">
        Token counts reported by the provider for your own API key, listed against the comparison
        run that used them. Costs are not calculated because providers report tokens, not prices;
        check your provider account for billing.
      </p>

      {data.usage.length === 0 ? (
        <section className="empty-state" aria-labelledby="usage-empty">
          <div className="empty-state-icon" aria-hidden="true">U</div>
          <p className="eyebrow">YOUR USAGE</p>
          <h2 id="usage-empty">No usage yet.</h2>
          <p className="muted-copy">
            Once a comparison is sent to your AI provider, its token usage will appear here.
          </p>
        </section>
      ) : (
        <>
          <ul className="usage-totals" aria-label="Totals by provider">
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
                <th>Run</th>
                <th>Date</th>
                <th>Provider</th>
                <th>Responses</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => {
                const records = byRun.get(run.id) ?? [];
                const total = records.reduce(add, EMPTY);
                const job = data.jobs.get(run.jobId);
                return (
                  <tr key={run.id} data-run-id={run.id}>
                    <td>
                      <a href={`#history/${run.id}`}>{job?.title ?? 'Saved job'}</a>
                      <span className={`run-status run-status-${run.status}`}>{run.status}</span>
                    </td>
                    <td>{formatDate(run.createdAt)}</td>
                    <td>{[...new Set(records.map((record) => record.provider))].join(', ')}</td>
                    <td>{total.responses.toLocaleString()}</td>
                    <td>{total.input.toLocaleString()}</td>
                    <td>{total.output.toLocaleString()}</td>
                  </tr>
                );
              })}
              {orphaned.length > 0 && (
                <tr data-run-id="deleted">
                  <td>Deleted runs</td>
                  <td>—</td>
                  <td>{[...new Set(orphaned.map((record) => record.provider))].join(', ')}</td>
                  <td>{orphaned.length.toLocaleString()}</td>
                  <td>{orphaned.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0).toLocaleString()}</td>
                  <td>{orphaned.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0).toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
