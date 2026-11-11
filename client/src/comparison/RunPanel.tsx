import { useEffect, useRef, useState } from 'react';
import type { LocalDataServices } from '../data/local-data-service';
import type { ComparisonRunRecord, JobRecord, ProviderId } from '../data/models';
import { CredentialVault } from '../providers/credential-vault';
import { providerRegistry as defaultRegistry } from '../providers/provider-runtime';
import type { ProviderRegistry } from '../providers/provider-adapter';
import { resolveProviderSelection } from './comparison-service';
import { GapReportView } from './GapReportView';
import { buildComparisonPrompt, type ComparisonPrompt } from './prompt';
import {
  executeRun,
  jobToComparisonInput,
  resetInterruptedRun,
  retryRun,
  type RunProgress,
} from './run-executor';
import { parseRunResult } from './run-result';

interface RunPanelProps {
  services: LocalDataServices;
  run: ComparisonRunRecord;
  job?: JobRecord;
  registry?: ProviderRegistry;
  createVault?: (services: LocalDataServices) => CredentialVault;
  /** Called after the run changed so the parent can reload it. */
  onChanged: () => void;
}

interface ReviewData {
  providerId: ProviderId;
  providerName: string;
  model: string;
  hasKey: boolean;
  unlocked: boolean;
  prompts: { resumeName: string; prompt: ComparisonPrompt }[];
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function defaultCreateVault(services: LocalDataServices): CredentialVault {
  return new CredentialVault(services.credentials);
}

/** Review, send, follow, and read one comparison run. Nothing is sent until the user confirms. */
export function RunPanel({
  services,
  run,
  job,
  registry = defaultRegistry,
  createVault = defaultCreateVault,
  onChanged,
}: RunPanelProps) {
  const [phase, setPhase] = useState<'idle' | 'review' | 'running'>('idle');
  const [review, setReview] = useState<ReviewData | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const vaultRef = useRef<CredentialVault | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      vaultRef.current?.lock();
    },
    [],
  );

  function vault(): CredentialVault {
    vaultRef.current ??= createVault(services);
    return vaultRef.current;
  }

  async function openReview(): Promise<void> {
    setError(null);
    try {
      if (!job) throw new Error('The captured job is no longer saved in this browser.');
      const settings = (await services.settings.get('app')) ?? { preferredProvider: null };
      const { providerId, adapter, model } = resolveProviderSelection(settings, registry);
      const resumes = await Promise.all(run.resumeIds.map((id) => services.resumes.get(id)));
      const prompts = resumes.map((resume) => {
        if (!resume) throw new Error('One or more selected resumes are no longer available.');
        return {
          resumeName: resume.name,
          prompt: buildComparisonPrompt(jobToComparisonInput(job), {
            name: resume.name,
            text: resume.extractedText,
          }),
        };
      });
      setReview({
        providerId,
        providerName: adapter.name,
        model,
        hasKey: await vault().hasCredential(providerId),
        unlocked: vault().isUnlocked(providerId),
        prompts,
      });
      setPhase('review');
    } catch (reviewError) {
      setError(messageFrom(reviewError));
    }
  }

  async function send(): Promise<void> {
    if (!review) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase('running');
    setProgress(null);
    try {
      if (!vault().isUnlocked(review.providerId)) {
        await vault().unlock(review.providerId, passphrase);
      }
      setPassphrase('');
      await executeRun({
        services,
        runId: run.id,
        registry,
        vault: vault(),
        signal: controller.signal,
        onProgress: (update) => {
          setProgress(update);
          if (update.index === 1) {
            // The run just moved to "analysing"; let the list show it.
            onChanged();
          }
        },
      });
    } catch (sendError) {
      setError(messageFrom(sendError));
    } finally {
      // The key only stays in memory for the run itself.
      vault().lock(review.providerId);
      abortRef.current = null;
      setProgress(null);
      setPassphrase('');
      setReview(null);
      setPhase('idle');
      onChanged();
    }
  }

  async function recover(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await action();
    } catch (recoverError) {
      setError(messageFrom(recoverError));
    } finally {
      onChanged();
    }
  }

  const result = parseRunResult(run.result);

  return (
    <div className="run-panel">
      {error && <p className="inbox-feedback inbox-feedback-error" role="alert">{error}</p>}

      {run.status === 'received' && phase === 'idle' && (
        <button className="button button-secondary" onClick={() => void openReview()}>
          Review and send for comparison
        </button>
      )}

      {run.status === 'received' && phase === 'review' && review && (
        <section className="run-review" aria-label="Review what will be sent">
          <p>
            This will send the text below to <strong>{review.providerName}</strong> (
            {review.model}) using your own API key. Nothing is sent until you confirm.
          </p>
          {review.prompts.map(({ resumeName, prompt }) => (
            <article key={resumeName} className="run-review-item">
              <h5>{resumeName}</h5>
              <p className="muted-copy">
                About {prompt.estimatedInputTokens.toLocaleString()} input tokens
              </p>
              {prompt.warnings.map((warning) => (
                <p className="run-warning" role="status" key={warning}>{warning}</p>
              ))}
              <details>
                <summary>Show the exact text that will be sent</summary>
                <pre className="run-prompt">{prompt.systemPrompt}</pre>
                <pre className="run-prompt">{prompt.userPrompt}</pre>
              </details>
            </article>
          ))}
          {!review.hasKey && (
            <p className="inbox-feedback inbox-feedback-error" role="alert">
              No {review.providerName} API key is saved. Add one in{' '}
              <a href="#settings">Settings</a> first.
            </p>
          )}
          {review.hasKey && !review.unlocked && (
            <label className="run-passphrase">
              Passphrase for your saved {review.providerName} key
              <input
                type="password"
                autoComplete="off"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </label>
          )}
          <div className="run-actions">
            <button
              className="button button-primary"
              disabled={!review.hasKey || (!review.unlocked && passphrase === '')}
              onClick={() => void send()}
            >
              Send to {review.providerName}
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setReview(null);
                setPhase('idle');
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {phase === 'running' && (
        <div className="run-progress">
          <p role="status">
            {progress
              ? `Comparing “${progress.resumeName}” (${progress.index} of ${progress.total})…`
              : 'Starting the comparison…'}
          </p>
          <button className="button button-secondary" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {run.status === 'analysing' && phase !== 'running' && (
        <div className="run-progress">
          <p>
            This run is marked as analysing, but nothing in this window is working on it (the page
            may have been closed).
          </p>
          <button
            className="button button-secondary"
            onClick={() => void recover(() => resetInterruptedRun(services, run.id))}
          >
            Reset and try again
          </button>
        </div>
      )}

      {run.status === 'failed' && phase === 'idle' && (
        <button
          className="button button-secondary"
          onClick={() => void recover(() => retryRun(services, run.id))}
        >
          Try again
        </button>
      )}

      {result && result.reports.length > 0 && (
        <div className="run-reports">
          {result.reports.map((entry) => (
            <GapReportView key={entry.resumeId} entry={entry} />
          ))}
        </div>
      )}
      {result && result.failures.length > 0 && (
        <ul className="run-failures" aria-label="Resumes that could not be compared">
          {result.failures.map((failure) => (
            <li key={failure.resumeId} role="alert">
              {failure.resumeName}: {failure.error}
            </li>
          ))}
        </ul>
      )}
      {run.status === 'done' && !result && (
        <p className="inbox-feedback inbox-feedback-error" role="alert">
          The saved report could not be read.
        </p>
      )}
    </div>
  );
}
