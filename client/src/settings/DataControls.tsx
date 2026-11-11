import { useCallback, useEffect, useState } from 'react';
import { downloadTextFile } from '../comparison/download';
import { createLocalDataServices } from '../data/local-data-service';
import { useLocalServices } from '../data/use-local-services';

export const DATA_DELETED_EVENT = 'talentfly:data-deleted';
const CONFIRMATION_WORD = 'DELETE';

interface Counts {
  resumes: number;
  jobs: number;
  runs: number;
}

export function DataControls({
  serviceFactory = createLocalDataServices,
}: {
  serviceFactory?: typeof createLocalDataServices;
}) {
  const { services, error: openError } = useLocalServices(serviceFactory);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    if (!services) return;
    const [resumes, jobs, runs] = await Promise.all([
      services.resumes.getAll(),
      services.jobs.getAll(),
      services.runs.getAll(),
    ]);
    setCounts({ resumes: resumes.length, jobs: jobs.length, runs: runs.length });
  }, [services]);

  useEffect(() => {
    void refreshCounts().catch(() => setCounts(null));
  }, [refreshCounts]);

  async function exportAll(): Promise<void> {
    if (!services) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const exported = await services.exportData();
      const day = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `talentfly-export-${day}.json`,
        JSON.stringify(exported, null, 2),
        'application/json',
      );
      setNotice('Export saved. It contains your resumes and reports, so keep the file private.');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'The export failed.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll(): Promise<void> {
    if (!services || confirmation !== CONFIRMATION_WORD) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await services.deleteAll();
      setConfirming(false);
      setConfirmation('');
      await refreshCounts();
      window.dispatchEvent(new Event(DATA_DELETED_EVENT));
      setNotice('Everything on this device was deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Deleting your data failed.');
    } finally {
      setBusy(false);
    }
  }

  const failure = openError ?? error;

  return (
    <section className="data-controls" aria-labelledby="data-controls-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR DATA</p>
          <h2 id="data-controls-title">Data controls</h2>
        </div>
      </div>
      <p className="muted-copy">
        Everything lives in this browser only
        {counts
          ? `: ${counts.resumes} resumes, ${counts.jobs} saved jobs, ${counts.runs} comparisons.`
          : '.'}
      </p>
      {failure && <p className="inbox-feedback inbox-feedback-error" role="alert">{failure}</p>}
      {notice && <p className="inbox-feedback inbox-feedback-success" role="status">{notice}</p>}

      <div className="data-control">
        <h3>Export all data</h3>
        <p className="muted-copy">
          Downloads a JSON file with your resumes (including the original files), saved jobs,
          comparison reports, usage history, and settings. Your encrypted API keys are never
          included.
        </p>
        <button
          className="button button-secondary"
          disabled={!services || busy}
          onClick={() => void exportAll()}
        >
          Export all data
        </button>
      </div>

      <div className="data-control data-control-danger">
        <h3>Delete all data</h3>
        <p className="muted-copy">
          Permanently deletes your resumes, saved jobs, comparison reports, usage history,
          settings, <strong>and your saved encrypted API keys</strong> from this browser. This
          cannot be undone. Export first if you want a copy.
        </p>
        {!confirming ? (
          <button
            className="button button-secondary"
            disabled={!services || busy}
            onClick={() => setConfirming(true)}
          >
            Delete all data…
          </button>
        ) : (
          <div className="data-confirm">
            <label>
              Type {CONFIRMATION_WORD} to confirm
              <input
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <div className="run-actions">
              <button
                className="button button-primary"
                disabled={busy || confirmation !== CONFIRMATION_WORD}
                onClick={() => void deleteAll()}
              >
                Delete everything on this device
              </button>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setConfirmation('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
