import type { BuildInfo } from './build-info';
import { captureCurrentTab, toCapturedJob, type JobCapture } from './job-capture';
import {
  createProtocolMessage,
  type ProtocolMessage,
  type ResumeSummary,
  type RunStatus,
} from '@talentfly/shared';
import {
  checkRelayWorker,
  PwaRequestError,
  relayToPwa,
  type ExtensionRuntime,
} from './extension-transport';
import { UnsupportedSiteError } from './supported-site';

interface PopupBridge {
  available: boolean;
  /** Confirms the background worker is current; rejects with an actionable message if not. */
  checkWorker?(): Promise<void>;
  request(message: ProtocolMessage): Promise<ProtocolMessage>;
}

function browserPopupBridge(): PopupBridge {
  const chromeApi = (
    globalThis as typeof globalThis & {
      chrome?: { runtime: ExtensionRuntime & { id: string } };
    }
  ).chrome;
  return {
    available: Boolean(chromeApi?.runtime?.id),
    async checkWorker() {
      if (!chromeApi) {
        throw new Error('Extension messaging is not available in this browser.');
      }
      await checkRelayWorker(chromeApi.runtime);
    },
    async request(message) {
      if (!chromeApi) {
        throw new Error('Extension messaging is not available in this browser.');
      }
      return relayToPwa(chromeApi.runtime, message);
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function externalLink(text: string, url: URL, className: string): HTMLAnchorElement {
  const link = el('a', className, text);
  link.href = url.toString();
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_FAILURES = 3;

interface TrackedRun {
  runId: string;
  status: RunStatus;
  error?: string;
}

const STATUS_TEXT: Record<RunStatus, string> = {
  received: 'Waiting for you in TalentFly. Open the result to review and send it.',
  analysing: 'Comparing your resume with the job…',
  done: 'Comparison complete.',
  failed: 'The comparison failed. Open the result to try again.',
};

function isFinished(status: RunStatus): boolean {
  return status === 'done' || status === 'failed';
}

type ConnectionState = 'checking' | 'connected' | 'disconnected';
type JobState = 'reading' | 'ready' | 'unsupported' | 'error';

export function renderPopup(
  root: HTMLElement,
  pwaOrigin: string,
  buildInfo: BuildInfo,
  extractJob: () => Promise<JobCapture> = captureCurrentTab,
  bridge: PopupBridge = browserPopupBridge(),
  options: { pollIntervalMs?: number } = {},
): void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let connection: ConnectionState = 'checking';
  let jobState: JobState = 'reading';
  let job: JobCapture | null = null;
  let resumes: ResumeSummary[] = [];
  let selectedResumeId = '';
  let runRequest: { key: string; id: string } | null = null;
  let running = false;
  // The PWA owns the run lifecycle; the popup only mirrors it and keeps nothing of its own.
  let tracked: TrackedRun | null = null;
  let generation = 0;
  let lookupKey: string | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollFailures = 0;

  // Header
  const header = el('header', 'popup-header');
  const logo = el('img', 'popup-logo');
  logo.src = '/talentfly-mark.svg';
  logo.alt = '';
  const brand = el('span', 'popup-brand');
  brand.append(document.createTextNode('Talent'), el('span', '', 'Fly'));
  header.append(logo, brand);

  // PWA connection bar (always visible, at the top)
  const connectionBar = el('section', 'connection-bar');
  const connectionDot = el('span', 'connection-dot');
  const connectionText = el('span', 'connection-text');
  connectionText.setAttribute('role', 'status');
  const refreshButton = el('button', 'connection-refresh', 'Connect');
  refreshButton.type = 'button';
  connectionBar.append(connectionDot, connectionText, refreshButton);

  const connectionError = el('p', 'connection-error');
  connectionError.setAttribute('role', 'alert');
  connectionError.hidden = true;
  const connectionHint = el('p', 'connection-hint');
  const workspaceUrl = new URL(pwaOrigin);
  workspaceUrl.hash = 'inbox';
  const openWorkspace = externalLink('Open TalentFly →', workspaceUrl, 'text-button');
  connectionHint.append(
    document.createTextNode('Open the TalentFly app in a tab, then choose Connect. '),
    openWorkspace,
  );

  // Job details
  const jobCard = el('section', 'card');
  jobCard.append(el('h2', 'card-title', 'Job details'));
  const jobStatus = el('p', 'card-note');
  jobStatus.setAttribute('role', 'status');
  const jobError = el('p', 'card-error');
  jobError.setAttribute('role', 'alert');
  const retryExtract = el('button', 'secondary-button', 'Read page again');
  retryExtract.type = 'button';
  const jobFields = el('dl', 'job-fields');
  const jobDescription = el('details', 'job-description');
  const jobDescriptionSummary = el('summary', '', 'Job description');
  const jobDescriptionText = el('pre', 'job-description-text');
  jobDescription.append(jobDescriptionSummary, jobDescriptionText);
  jobCard.append(jobStatus, jobError, retryExtract, jobFields, jobDescription);

  // Resumes + run
  const runCard = el('section', 'card');
  const runCardTitle = el('h2', 'card-title', 'Compare with');
  runCard.append(runCardTitle);
  const resumePickerLabel = el('label', 'resume-picker');
  resumePickerLabel.append(el('span', 'visually-hidden', 'Resume to compare'));
  const resumeSelect = el('select', 'resume-select');
  resumeSelect.name = 'resume';
  resumePickerLabel.append(resumeSelect);
  const runNote = el('p', 'card-note');
  const runError = el('p', 'card-error');
  runError.setAttribute('role', 'alert');
  runError.hidden = true;
  const runButton = el('button', 'primary-button', 'Create comparison run');
  runButton.type = 'button';
  const runResult = el('div', 'run-result');
  const statusLine = el('p', 'status-line');
  statusLine.setAttribute('role', 'status');
  const statusChip = el('span', 'run-status');
  const statusText = el('span', 'status-text');
  statusLine.append(statusChip, statusText);
  const statusError = el('p', 'card-error');
  statusError.setAttribute('role', 'alert');
  const statusProblem = el('p', 'card-note status-problem');
  statusProblem.hidden = true;
  const resultLink = el('a', 'text-button', 'Open result →');
  resultLink.target = '_blank';
  resultLink.rel = 'noopener noreferrer';
  const compareAgainButton = el('button', 'secondary-button', 'Compare again');
  compareAgainButton.type = 'button';
  runResult.append(statusLine, statusError, resultLink, compareAgainButton);
  runCard.append(resumePickerLabel, runNote, runError, statusProblem, runButton, runResult);

  function setField(list: HTMLElement, label: string, value: string): void {
    const term = el('dt', 'job-field-label', label);
    const detail = el('dd', 'job-field-value', value || '—');
    list.append(term, detail);
  }

  function showJob(captured: JobCapture): void {
    job = captured;
    jobFields.replaceChildren();
    setField(jobFields, 'Title', captured.title);
    setField(jobFields, 'Company', captured.company);
    setField(jobFields, 'Location', captured.location);
    for (const [label, value] of Object.entries(captured.otherFields ?? {})) {
      setField(jobFields, label, value);
    }
    jobDescriptionText.textContent = captured.description;
    jobDescriptionSummary.textContent = captured.descriptionTruncated
      ? 'Job description (shortened to fit the limit)'
      : 'Job description';
    jobState = 'ready';
  }

  function canRun(): boolean {
    return (
      !running &&
      tracked === null &&
      jobState === 'ready' &&
      connection === 'connected' &&
      selectedResumeId !== ''
    );
  }

  function render(): void {
    const connectionLabel = {
      checking: 'Connecting to TalentFly…',
      connected: 'TalentFly connected',
      disconnected: 'TalentFly not connected',
    }[connection];
    connectionBar.dataset.state = connection;
    connectionText.textContent = connectionLabel;
    refreshButton.textContent = connection === 'connected' ? 'Refresh' : 'Connect';
    refreshButton.disabled = connection === 'checking';
    connectionHint.hidden = connection !== 'disconnected';

    jobStatus.hidden = jobState === 'ready' || jobState === 'error';
    jobStatus.textContent =
      jobState === 'reading' ? 'Reading the job details from this page…' : '';
    if (jobState === 'unsupported') {
      jobStatus.hidden = true;
    }
    jobError.hidden = jobState !== 'error' && jobState !== 'unsupported';
    retryExtract.hidden = jobState !== 'error';
    jobFields.hidden = jobState !== 'ready';
    jobDescription.hidden = jobState !== 'ready';

    const showRun = jobState === 'ready';
    runCard.hidden = !showRun;
    runCardTitle.textContent = tracked ? 'Comparison' : 'Compare with';
    runButton.hidden = tracked !== null;
    runButton.disabled = !canRun();
    runButton.textContent = running ? 'Creating run…' : 'Create comparison run';
    resumePickerLabel.hidden = tracked !== null || connection !== 'connected' || resumes.length === 0;
    runResult.hidden = tracked === null;
    if (tracked) {
      statusChip.textContent = tracked.status;
      statusChip.className = `run-status run-status-${tracked.status}`;
      statusText.textContent = STATUS_TEXT[tracked.status];
      statusError.hidden = tracked.status !== 'failed' || !tracked.error;
      statusError.textContent = tracked.error ?? '';
      const resultUrl = new URL(pwaOrigin);
      resultUrl.hash = `history/${tracked.runId}`;
      resultLink.href = resultUrl.toString();
      compareAgainButton.hidden = !isFinished(tracked.status);
    }
    if (tracked) {
      runNote.textContent = '';
    } else if (connection !== 'connected') {
      runNote.textContent = 'Connect to TalentFly to choose a resume.';
    } else if (resumes.length === 0) {
      runNote.textContent = 'No resumes yet. Add one in TalentFly, then choose Refresh.';
    } else {
      runNote.textContent = '';
    }
  }

  function renderResumes(): void {
    resumeSelect.replaceChildren(
      ...resumes.map((resume) => {
        const option = el('option', '', resume.name);
        option.value = resume.id;
        return option;
      }),
    );
    resumeSelect.value = selectedResumeId;
  }

  resumeSelect.addEventListener('change', () => {
    selectedResumeId = resumeSelect.value;
    runError.hidden = true;
    render();
  });

  function clearPoll(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll(): void {
    clearPoll();
    if (tracked && !isFinished(tracked.status)) {
      pollTimer = setTimeout(() => void poll(), pollIntervalMs);
    }
  }

  function track(update: TrackedRun): void {
    tracked = { runId: update.runId, status: update.status, error: update.error };
    pollFailures = 0;
    statusProblem.textContent = '';
    statusProblem.hidden = true;
    render();
    schedulePoll();
  }

  async function poll(): Promise<void> {
    const current = tracked;
    if (!current || isFinished(current.status)) return;
    try {
      const reply = await bridge.request(
        createProtocolMessage('GET_RUN_STATUS', { runId: current.runId }),
      );
      if (reply.type !== 'STATUS_UPDATE') throw new Error('Unexpected status response.');
      if (tracked?.runId === current.runId) {
        track(reply.payload);
      }
      return;
    } catch (error) {
      if (tracked?.runId !== current.runId) return;
      if (error instanceof PwaRequestError && error.code === 'NOT_FOUND') {
        // The run was deleted in TalentFly.
        tracked = null;
        clearPoll();
        render();
        return;
      }
      pollFailures += 1;
      if (pollFailures >= MAX_POLL_FAILURES) {
        statusProblem.textContent =
          'The status could not be refreshed. Open TalentFly, then choose Connect.';
        statusProblem.hidden = false;
        render();
        return;
      }
    }
    schedulePoll();
  }

  /** On open, show a run that already exists for this page so work is never started twice. */
  async function lookupExistingRun(): Promise<void> {
    if (connection !== 'connected' || jobState !== 'ready' || !job || tracked) return;
    if (lookupKey === job.sourceUrl) return;
    const key = job.sourceUrl;
    lookupKey = key;
    try {
      const reply = await bridge.request(
        createProtocolMessage('LATEST_RUN_FOR_URL', { sourceUrl: key }),
      );
      if (reply.type === 'STATUS_UPDATE' && !tracked && lookupKey === key) {
        track(reply.payload);
      }
    } catch (error) {
      if (error instanceof PwaRequestError && error.code === 'NOT_FOUND') return;
      lookupKey = null;
      statusProblem.textContent = 'Could not check for an earlier comparison of this job.';
      statusProblem.hidden = false;
    }
  }

  function compareAgain(): void {
    clearPoll();
    tracked = null;
    generation += 1;
    runRequest = null;
    // Do not look the old run up again; the user asked for a new one.
    lookupKey = job?.sourceUrl ?? null;
    render();
  }

  async function connect(): Promise<void> {
    runError.hidden = true;
    if (!bridge.available) {
      connection = 'disconnected';
      render();
      return;
    }
    connection = 'checking';
    connectionError.hidden = true;
    render();
    try {
      await bridge.checkWorker?.();
      const ping = await bridge.request(createProtocolMessage('PING', {}));
      if (ping.type !== 'PONG') {
        throw new Error('Unexpected readiness response.');
      }
      const reply = await bridge.request(createProtocolMessage('LIST_RESUMES', {}));
      if (reply.type !== 'RESUMES') {
        throw new Error('Unexpected resume response.');
      }
      resumes = reply.payload.resumes;
      // Keep the current choice if it still exists; otherwise default to the first resume.
      if (!resumes.some((resume) => resume.id === selectedResumeId)) {
        selectedResumeId = resumes[0]?.id ?? '';
      }
      connection = 'connected';
      renderResumes();
      if (tracked && !isFinished(tracked.status)) {
        track(tracked);
      }
    } catch (error) {
      connection = 'disconnected';
      lookupKey = null;
      clearPoll();
      connectionError.textContent =
        error instanceof Error ? error.message : 'Could not connect to TalentFly.';
      connectionError.hidden = false;
    }
    render();
    void lookupExistingRun();
  }

  async function extract(): Promise<void> {
    jobState = 'reading';
    jobError.hidden = true;
    render();
    try {
      showJob(await extractJob());
    } catch (error) {
      job = null;
      jobState = error instanceof UnsupportedSiteError ? 'unsupported' : 'error';
      jobError.textContent =
        error instanceof Error ? error.message : 'The job details could not be read.';
    }
    render();
    void lookupExistingRun();
  }

  async function createRun(): Promise<void> {
    if (!canRun()) return;
    running = true;
    runError.hidden = true;
    render();
    // Always send what the page shows right now, not what was read when the popup opened.
    try {
      showJob(await extractJob());
    } catch (error) {
      job = null;
      jobState = error instanceof UnsupportedSiteError ? 'unsupported' : 'error';
      jobError.textContent =
        error instanceof Error ? error.message : 'The job details could not be read.';
      running = false;
      render();
      return;
    }
    if (!job) return;
    // One message ID per job + resume selection: a retry (even after a timeout where the
    // first request did reach the PWA) is deduplicated there instead of creating a second run.
    const key = JSON.stringify([
      generation,
      job.sourceUrl,
      job.title,
      job.description,
      job.otherFields ?? {},
      selectedResumeId,
    ]);
    if (runRequest?.key !== key) {
      runRequest = { key, id: crypto.randomUUID() };
    }
    try {
      const response = await bridge.request(
        createProtocolMessage(
          'START_COMPARISON',
          {
            job: toCapturedJob(job),
            resumeIds: [selectedResumeId],
          },
          runRequest.id,
        ),
      );
      if (response.type !== 'STATUS_UPDATE') {
        throw new Error('TalentFly returned an unexpected status.');
      }
      track(response.payload);
    } catch (error) {
      runError.textContent =
        error instanceof Error ? error.message : 'The comparison run could not be created.';
      runError.hidden = false;
      connection = 'disconnected';
      // The PWA may have created the run even though the reply was lost; look again on reconnect.
      lookupKey = null;
    } finally {
      running = false;
      render();
    }
  }

  refreshButton.addEventListener('click', () => void connect());
  retryExtract.addEventListener('click', () => void extract());
  runButton.addEventListener('click', () => void createRun());
  compareAgainButton.addEventListener('click', compareAgain);

  const footerLink = el('footer', 'popup-footer');
  footerLink.append(
    el('span', 'footer-dot'),
    el('span', 'footer-build', `Extension v${buildInfo.version} (${buildInfo.commit})`),
  );

  root.replaceChildren(header, connectionBar, connectionError, connectionHint, jobCard, runCard, footerLink);
  render();
  void connect();
  void extract();
}
