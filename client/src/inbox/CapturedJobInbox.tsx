import { useEffect, useRef, useState } from 'react';
import {
  createProtocolMessage,
  type CapturedJob,
  type ProtocolMessage,
} from '@talentfly/shared';
import {
  createLocalDataServices,
  createRecordId,
  type LocalDataServices,
} from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord, ResumeRecord } from '../data/models';
import { validateExtensionWindowMessage } from '../services/extension-protocol';
import {
  ExtensionPortClient,
  type ExtensionRuntimeClient,
} from '../services/extension-port';

interface CapturedJobInboxProps {
  extensionId: string;
  serviceFactory?: typeof createLocalDataServices;
}

interface PendingCapture {
  messageId: string;
  job: CapturedJob;
  savedJob?: JobRecord;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The extension message could not be processed.';
}

function createJobRecord(messageId: string, job: CapturedJob): JobRecord {
  const now = new Date().toISOString();
  return {
    id: createRecordId('job'),
    captureMessageId: messageId,
    title: job.title,
    company: job.company || undefined,
    location: job.location || undefined,
    sourceUrl: job.sourceUrl,
    description: job.description,
    createdAt: now,
    updatedAt: now,
  };
}

export function CapturedJobInbox({
  extensionId,
  serviceFactory = createLocalDataServices,
}: CapturedJobInboxProps) {
  const servicesRef = useRef<LocalDataServices | null>(null);
  const receivedMessageIds = useRef(new Set<string>());
  const pendingCaptureReplies = useRef(
    new Map<string, (message: ProtocolMessage) => void>(),
  );
  const [pendingCaptures, setPendingCaptures] = useState<PendingCapture[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [runs, setRuns] = useState<ComparisonRunRecord[]>([]);
  const [resumeSummaries, setResumeSummaries] = useState<Pick<ResumeRecord, 'id' | 'name'>[]>([]);
  const [selectedResumeIds, setSelectedResumeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deepLinkedRunId = new URLSearchParams(window.location.search).get('runId');
  const deepLinkedRun = runs.find((run) => run.id === deepLinkedRunId);

  async function refresh(): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      return;
    }
    const [storedJobs, storedRuns, resumes] = await Promise.all([
      services.jobs.getAll(),
      services.runs.getAll(),
      services.resumes.getAll(),
    ]);
    setJobs(
      storedJobs
        .filter((job) => job.captureMessageId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
    setRuns(storedRuns.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    setResumeSummaries(resumes.map(({ id, name }) => ({ id, name })));
  }

  useEffect(() => {
    let active = true;
    let runtime: LocalDataServices | null = null;
    let extensionPort: ExtensionPortClient | null = null;
    let openPromise: Promise<void>;
    const allowedOrigins = [window.location.origin];

    const processMessage = async (
      message: ProtocolMessage,
      respond: (response: ProtocolMessage) => void,
    ): Promise<void> => {
      if (!active || !servicesRef.current) {
        return;
      }
      const services = servicesRef.current;
      switch (message.type) {
        case 'PING':
          respond(createProtocolMessage('PONG', { ready: true }, message.messageId));
          return;
        case 'JOB_CAPTURED': {
          const savedJob = await services.getCapturedJob(message.messageId);
          if (savedJob) {
            respond(
              createProtocolMessage(
                'CAPTURE_ACK',
                { accepted: true, jobId: savedJob.id },
                message.messageId,
              ),
            );
            return;
          }
          if (receivedMessageIds.current.has(message.messageId)) {
            return;
          }
          receivedMessageIds.current.add(message.messageId);
          pendingCaptureReplies.current.set(message.messageId, respond);
          setPendingCaptures((current) => [
            ...current,
            {
              messageId: message.messageId,
              job: message.payload.job,
              savedJob,
            },
          ]);
          return;
        }
        case 'LIST_RESUMES': {
          const resumes = await services.resumes.getAll();
          respond(
            createProtocolMessage(
              'RESUMES',
              { resumes: resumes.map(({ id, name }) => ({ id, name })) },
              message.messageId,
            ),
          );
          return;
        }
        case 'LIST_JOBS': {
          const savedJobs = await services.jobs.getAll();
          respond(
            createProtocolMessage(
              'JOBS',
              {
                jobs: savedJobs
                  .filter((job) => job.captureMessageId)
                  .map(({ id, title, company, location }) => ({
                    id,
                    title,
                    ...(company ? { company } : {}),
                    ...(location ? { location } : {}),
                  })),
              },
              message.messageId,
            ),
          );
          return;
        }
        case 'START_COMPARISON': {
          const run = await services.createComparisonRun({
            idempotencyKey: message.messageId,
            jobId: message.payload.jobId,
            resumeIds: message.payload.resumeIds,
          });
          await refresh();
          respond(
            createProtocolMessage(
              'STATUS_UPDATE',
              { runId: run.id, status: run.status },
              message.messageId,
            ),
          );
          setNotice(`Comparison run ${run.id} was saved locally.`);
          return;
        }
        case 'PONG':
        case 'CAPTURE_ACK':
        case 'RESUMES':
        case 'JOBS':
        case 'STATUS_UPDATE':
          return;
      }
    };

    const receiveMessage = (event: MessageEvent<unknown>) => {
      if (!event.origin.startsWith('chrome-extension://')) {
        return;
      }
      let validated: ReturnType<typeof validateExtensionWindowMessage>;
      try {
        validated = validateExtensionWindowMessage(event, extensionId, allowedOrigins);
      } catch (validationError) {
        setError(messageFrom(validationError));
        return;
      }
      void openPromise
        .then(() =>
          processMessage(validated.message, (response) =>
            validated.source.postMessage(response, validated.targetOrigin),
          ),
        )
        .catch((processingError: unknown) => {
          if (active) {
            setError(messageFrom(processingError));
          }
        });
    };

    openPromise = serviceFactory()
      .then(async (services) => {
        runtime = services;
        if (!active) {
          services.close();
          return;
        }
        servicesRef.current = services;
        await refresh();
        const extensionRuntime = (
          globalThis as typeof globalThis & {
            chrome?: { runtime?: ExtensionRuntimeClient };
          }
        ).chrome?.runtime;
        if (extensionId && extensionRuntime) {
          try {
            extensionPort = new ExtensionPortClient(
              extensionRuntime,
              extensionId,
              (message) => {
                void processMessage(message, (response) =>
                  extensionPort?.postMessage(response),
                ).catch((processingError: unknown) => {
                  if (active) {
                    setError(messageFrom(processingError));
                  }
                });
              },
            );
          } catch (connectionError) {
            setError(messageFrom(connectionError));
          }
        }
        if (active) {
          setLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(messageFrom(loadError));
          setLoading(false);
        }
      });

    window.addEventListener('message', receiveMessage);
    return () => {
      active = false;
      window.removeEventListener('message', receiveMessage);
      extensionPort?.close();
      pendingCaptureReplies.current.clear();
      runtime?.close();
      servicesRef.current = null;
    };
  }, [extensionId, serviceFactory]);

  async function saveCapturedJob(capture: PendingCapture): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      setError('The local data store is not available.');
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const savedJob = await services.saveCapturedJob(
        capture.savedJob ?? createJobRecord(capture.messageId, capture.job),
      );
      setPendingCaptures((current) =>
        current.map((item) =>
          item.messageId === capture.messageId ? { ...item, savedJob } : item,
        ),
      );
      await refresh();
      pendingCaptureReplies.current
        .get(capture.messageId)
        ?.(
          createProtocolMessage(
            'CAPTURE_ACK',
            { accepted: true, jobId: savedJob.id },
            capture.messageId,
          ),
        );
      pendingCaptureReplies.current.delete(capture.messageId);
      setNotice('Job description saved locally. It has not been sent to an AI provider.');
    } catch (saveError) {
      setError(messageFrom(saveError));
    }
  }

  function toggleResume(resumeId: string): void {
    setSelectedResumeIds((current) =>
      current.includes(resumeId)
        ? current.filter((id) => id !== resumeId)
        : [...current, resumeId],
    );
  }

  async function startLocalRun(job: JobRecord): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      setError('The local data store is not available.');
      return;
    }
    if (selectedResumeIds.length === 0) {
      setError('Choose at least one resume to create a comparison run.');
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const run = await services.createComparisonRun({
        idempotencyKey: createRecordId('request'),
        jobId: job.id,
        resumeIds: selectedResumeIds,
      });
      await refresh();
      setNotice(`Comparison run ${run.id} was created with status "${run.status}".`);
    } catch (runError) {
      setError(messageFrom(runError));
    }
  }

  return (
    <section className="captured-inbox" aria-labelledby="captured-inbox-heading">
      <header className="captured-inbox-header">
        <p className="eyebrow">EXTENSION INBOX</p>
        <h2 id="captured-inbox-heading">Review captured jobs.</h2>
        <p className="muted-copy">
          Captured content stays in this browser. Confirm each job before saving it.
        </p>
      </header>

      {!extensionId && (
        <p className="inbox-feedback inbox-feedback-error" role="alert">
          Extension handoff is not configured. Set VITE_TALENTFLY_EXTENSION_ID to the installed
          extension ID before receiving captures.
        </p>
      )}
      {error && <p className="inbox-feedback inbox-feedback-error" role="alert">{error}</p>}
      {notice && <p className="inbox-feedback inbox-feedback-success" role="status">{notice}</p>}
      {loading ? (
        <p className="inbox-loading" role="status">Opening local jobs and comparison history…</p>
      ) : (
        <>
          {pendingCaptures.length > 0 && (
            <section className="inbox-pending" aria-label="Captured job previews">
              <h3>Needs your review</h3>
              {pendingCaptures.map((capture) => (
                <article className="inbox-capture-card" key={capture.messageId}>
                  <p className="eyebrow">CAPTURED FROM EXTENSION</p>
                  <h4>{capture.job.title || 'Untitled job'}</h4>
                  <p className="inbox-job-meta">
                    {[capture.job.company, capture.job.location].filter(Boolean).join(' · ') ||
                      'Company and location not detected'}
                  </p>
                  <p className="inbox-job-source">{capture.job.sourceUrl}</p>
                  <details>
                    <summary>Review job description</summary>
                    <p className="inbox-job-description">{capture.job.description}</p>
                  </details>
                  {capture.savedJob ? (
                    <p className="inbox-saved-note" role="status">
                      This capture is already saved locally.
                    </p>
                  ) : (
                    <button
                      className="button button-primary"
                      onClick={() => void saveCapturedJob(capture)}
                    >
                      Confirm and save on this device
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}

          <section className="inbox-saved-jobs" aria-label="Saved captured jobs">
            <h3>Saved jobs</h3>
            {jobs.length === 0 ? (
              <p className="muted-copy">No captured jobs have been confirmed yet.</p>
            ) : (
              jobs.map((job) => (
                <article className="inbox-saved-job" key={job.id}>
                  <div>
                    <h4>{job.title}</h4>
                    <p>{[job.company, job.location].filter(Boolean).join(' · ')}</p>
                    <a href={job.sourceUrl} target="_blank" rel="noreferrer">
                      View source page
                    </a>
                  </div>
                  <details>
                    <summary>Choose resumes for a run</summary>
                    {resumeSummaries.length === 0 ? (
                      <p>Add a resume before creating a comparison run.</p>
                    ) : (
                      <fieldset className="inbox-resume-picker">
                        <legend>Select one or more resumes</legend>
                        {resumeSummaries.map((resume) => (
                          <label key={resume.id}>
                            <input
                              checked={selectedResumeIds.includes(resume.id)}
                              type="checkbox"
                              onChange={() => toggleResume(resume.id)}
                            />
                            {resume.name}
                          </label>
                        ))}
                        <button
                          className="button button-secondary"
                          disabled={selectedResumeIds.length === 0}
                          onClick={() => void startLocalRun(job)}
                        >
                          Create local comparison run
                        </button>
                      </fieldset>
                    )}
                  </details>
                </article>
              ))
            )}
          </section>

          <section className="inbox-runs" aria-label="Comparison runs">
            <h3>Comparison runs</h3>
            {deepLinkedRun && (
              <article className="inbox-run-detail" aria-label="Opened comparison run">
                <p className="eyebrow">OPENED RUN</p>
                <h4>{jobs.find((job) => job.id === deepLinkedRun.jobId)?.title ?? 'Saved job'}</h4>
                <p>
                  Run {deepLinkedRun.id} is saved with status <strong>{deepLinkedRun.status}</strong>.
                  The analysis step is not available yet.
                </p>
              </article>
            )}
            {runs.length === 0 ? (
              <p className="muted-copy">No comparison runs have been created.</p>
            ) : (
              <ul>
                {runs.map((run) => (
                  <li
                    className={run.id === deepLinkedRunId ? 'inbox-run-selected' : undefined}
                    data-run-id={run.id}
                    key={run.id}
                  >
                    <span>{jobs.find((job) => job.id === run.jobId)?.title ?? 'Saved job'}</span>
                    <span className={`run-status run-status-${run.status}`}>{run.status}</span>
                    {run.error && <span role="alert">{run.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
