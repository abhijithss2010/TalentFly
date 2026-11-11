import { useEffect, useState } from 'react';
import { createLocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord, ResumeRecord } from '../data/models';
import { useLocalServices } from '../data/use-local-services';
import { parseRunResult } from './run-result';

interface HistoryData {
  runs: ComparisonRunRecord[];
  jobs: Map<string, JobRecord>;
  resumes: Map<string, ResumeRecord>;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
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
    ])
      .then(([runs, jobs, resumes]) => {
        if (!active) return;
        setData({
          runs: runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          jobs: new Map(jobs.map((job) => [job.id, job])),
          resumes: new Map(resumes.map((resume) => [resume.id, resume])),
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
    </div>
  );
}
