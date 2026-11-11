import type { BuildInfo } from './build-info';
import {
  captureCurrentTab,
  MAX_JOB_DESCRIPTION_LENGTH,
  type JobCapture,
} from './job-capture';
import {
  createProtocolMessage,
  type JobSummary,
  type ProtocolMessage,
  type ResumeSummary,
} from '@talentfly/shared';
import { relayToPwa, queueCaptureAndOpenPwa, type ExtensionRuntime } from './extension-transport';

interface PopupBridge {
  available: boolean;
  request(message: ProtocolMessage): Promise<ProtocolMessage>;
  sendCapture(pwaOrigin: string, job: JobCapture): Promise<void>;
}

interface ChromePopupApi {
  runtime: ExtensionRuntime & { id: string };
  storage: { session: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  } };
  tabs: { create(properties: { url: string; active?: boolean }): Promise<unknown> };
}

function browserPopupBridge(): PopupBridge {
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromePopupApi }).chrome;
  return {
    available: Boolean(chromeApi?.runtime?.id && chromeApi.storage?.session && chromeApi.tabs),
    async request(message) {
      if (!chromeApi) {
        throw new Error('Extension messaging is not available in this browser.');
      }
      return relayToPwa(chromeApi.runtime, message);
    },
    async sendCapture(pwaOrigin, job) {
      if (!chromeApi) {
        throw new Error('The active Chrome extension context is not available.');
      }
      await queueCaptureAndOpenPwa(chromeApi, pwaOrigin, {
        title: job.title,
        company: job.company,
        location: job.location,
        sourceUrl: job.sourceUrl,
        description: job.description,
      });
    },
  };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function renderPopup(
  root: HTMLElement,
  pwaOrigin: string,
  buildInfo: BuildInfo,
  captureJob: () => Promise<JobCapture> = captureCurrentTab,
  bridge: PopupBridge = browserPopupBridge(),
): void {
  const header = createElement('header', 'popup-header');
  const logo = createElement('img', 'popup-logo');
  logo.src = '/talentfly-mark.svg';
  logo.alt = '';

  const brand = createElement('span', 'popup-brand');
  brand.append(document.createTextNode('Talent'));
  const brandAccent = createElement('span', '', 'Fly');
  brand.append(brandAccent);

  header.append(logo, brand, createElement('span', 'popup-caption', 'ROLE WORKSPACE'));

  const content = createElement('section', 'popup-content');
  content.append(
    createElement('p', 'popup-eyebrow', 'A THOUGHTFUL NEXT STEP'),
    createElement('h1', 'popup-title', 'Make your next move count.'),
    createElement(
      'p',
      'popup-description',
      'Find a role that feels right. TalentFly helps you see where your experience fits.',
    ),
  );

  const captureCard = createElement('section', 'capture-card');
  const captureHeading = createElement('h2', 'capture-card-title');
  captureHeading.append(
    createElement('span', 'capture-icon', '↗'),
    document.createTextNode('Explore a job posting'),
  );
  captureCard.append(
    captureHeading,
    createElement(
      'p',
      'capture-card-copy',
      'Capture visible job details from this tab. The editable preview stays here and is not sent or saved.',
    ),
    createElement('p', 'origin-label', `Workspace: ${pwaOrigin}`),
  );

  const captureButton = createElement('button', 'capture-button', 'Capture this page');
  captureButton.type = 'button';
  const captureStatus = createElement('p', 'capture-status');
  captureStatus.setAttribute('role', 'status');
  captureStatus.hidden = true;

  const captureError = createElement('p', 'capture-error');
  captureError.setAttribute('role', 'alert');
  captureError.hidden = true;

  const preview = createElement('section', 'capture-preview');
  preview.setAttribute('aria-labelledby', 'preview-heading');
  preview.hidden = true;
  const previewHeading = createElement('h3', 'preview-title', 'Review captured details');
  previewHeading.id = 'preview-heading';
  preview.append(previewHeading);

  function addTextField(
    fieldName: keyof Pick<JobCapture, 'title' | 'company' | 'location'>,
    labelText: string,
  ): HTMLInputElement {
    const label = createElement('label', 'preview-label', labelText);
    const input = createElement('input', 'preview-input');
    input.type = 'text';
    input.name = fieldName;
    input.maxLength = 200;
    input.addEventListener('input', () => {
      if (captured) {
        captured[fieldName] = input.value;
      }
    });
    label.append(input);
    preview.append(label);
    return input;
  }

  const titleInput = addTextField('title', 'Job title');
  const companyInput = addTextField('company', 'Company');
  const locationInput = addTextField('location', 'Location');
  const descriptionLabel = createElement('label', 'preview-label', 'Job description');
  const descriptionInput = createElement('textarea', 'preview-textarea');
  descriptionInput.name = 'description';
  descriptionInput.rows = 11;
  descriptionInput.maxLength = MAX_JOB_DESCRIPTION_LENGTH;
  descriptionInput.addEventListener('input', () => {
    if (captured) {
      captured.description = descriptionInput.value;
    }
  });
  descriptionLabel.append(descriptionInput);
  preview.append(descriptionLabel);

  const sourceUrl = createElement('p', 'preview-source');
  preview.append(sourceUrl);
  const trimButton = createElement('button', 'preview-secondary-button', 'Trim description whitespace');
  trimButton.type = 'button';
  trimButton.addEventListener('click', () => {
    descriptionInput.value = descriptionInput.value
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    descriptionInput.dispatchEvent(new Event('input'));
  });

  const clearButton = createElement('button', 'preview-secondary-button', 'Clear preview');
  clearButton.type = 'button';
  clearButton.addEventListener('click', () => {
    captured = null;
    preview.hidden = true;
    captureError.hidden = true;
    captureStatus.textContent = 'Preview cleared. Page content was not saved or sent.';
    captureStatus.hidden = false;
  });
  const sendCaptureButton = createElement('button', 'button button-primary send-capture-button', 'Send to TalentFly');
  sendCaptureButton.type = 'button';
  const sendCaptureStatus = createElement('p', 'capture-status');
  sendCaptureStatus.hidden = true;
  sendCaptureButton.addEventListener('click', async () => {
    if (!captured) {
      return;
    }
    sendCaptureButton.disabled = true;
    sendCaptureStatus.hidden = false;
    sendCaptureStatus.textContent = 'Opening TalentFly and handing off this reviewed capture…';
    try {
      await bridge.sendCapture(pwaOrigin, captured);
      sendCaptureStatus.textContent =
        'Capture sent to the TalentFly inbox for your review. It is held temporarily until the PWA confirms it.';
    } catch (error) {
      sendCaptureStatus.textContent =
        error instanceof Error ? error.message : 'The job could not be sent to TalentFly.';
      sendCaptureButton.disabled = false;
    }
  });
  preview.append(trimButton, sendCaptureButton, sendCaptureStatus, clearButton);

  let captured: JobCapture | null = null;
  captureButton.addEventListener('click', async () => {
    captureButton.disabled = true;
    captureButton.textContent = 'Capturing…';
    captureError.hidden = true;
    captureStatus.textContent = 'Reading visible page content…';
    captureStatus.hidden = false;
    try {
      captured = await captureJob();
      titleInput.value = captured.title;
      companyInput.value = captured.company;
      locationInput.value = captured.location;
      descriptionInput.value = captured.description;
      sourceUrl.textContent = `Source page: ${captured.sourceUrl}`;
      preview.hidden = false;
      captureStatus.textContent = captured.descriptionTruncated
        ? `Preview ready. The description was limited to ${MAX_JOB_DESCRIPTION_LENGTH.toLocaleString()} characters.`
        : 'Preview ready. Edit any field before using it.';
    } catch (error) {
      captureStatus.hidden = true;
      captureError.textContent =
        error instanceof Error ? error.message : 'The active page could not be captured.';
      captureError.hidden = false;
    } finally {
      captureButton.disabled = false;
      captureButton.textContent = 'Capture this page';
    }
  });

  captureCard.append(captureButton, captureStatus, captureError, preview);
  content.append(captureCard);

  const handoffCard = createElement('section', 'capture-card handoff-card');
  handoffCard.append(
    createElement('h2', 'capture-card-title', 'Compare a saved job'),
    createElement(
      'p',
      'capture-card-copy',
      'Connect to the TalentFly PWA to choose saved resumes and create a local comparison run.',
    ),
  );
  const handoffStatus = createElement('p', 'capture-status');
  handoffStatus.setAttribute('role', 'status');
  handoffStatus.textContent = bridge.available
    ? 'Checking for an open TalentFly PWA…'
    : 'Open the installed Chrome extension to connect to the PWA.';

  const handoffError = createElement('p', 'capture-error');
  handoffError.setAttribute('role', 'alert');
  handoffError.hidden = true;

  const refreshButton = createElement('button', 'preview-secondary-button', 'Connect / refresh');
  refreshButton.type = 'button';
  const recoveryActions = createElement('div', 'recovery-actions');
  recoveryActions.hidden = true;
  const openPwaAction = createElement('a', 'text-button', 'Open TalentFly →');
  const workspaceUrl = new URL(pwaOrigin);
  workspaceUrl.hash = 'inbox';
  openPwaAction.href = workspaceUrl.toString();
  openPwaAction.target = '_blank';
  openPwaAction.rel = 'noopener noreferrer';
  const retryButton = createElement('button', 'preview-secondary-button', 'Retry');
  retryButton.type = 'button';
  recoveryActions.append(openPwaAction, retryButton);
  const jobPickerLabel = createElement('label', 'preview-label', 'Saved job');
  const jobPicker = createElement('select', 'preview-input');
  jobPicker.name = 'saved-job';
  const resumePicker = createElement('fieldset', 'resume-picker');
  const resumeLegend = createElement('legend', '', 'Select up to five resumes');
  resumePicker.append(resumeLegend);
  const runButton = createElement('button', 'button button-primary', 'Create comparison run');
  runButton.type = 'button';
  runButton.disabled = true;
  const runResult = createElement('div', 'run-result');
  runResult.hidden = true;
  jobPickerLabel.append(jobPicker);
  const handoffControls = createElement('div', 'handoff-controls');
  handoffControls.append(jobPickerLabel, resumePicker, runButton);
  handoffControls.hidden = true;

  let savedJobs: JobSummary[] = [];
  let resumes: ResumeSummary[] = [];
  const selectedResumeIds = new Set<string>();

  function updateRunButton(): void {
    runButton.disabled = !jobPicker.value || selectedResumeIds.size === 0;
  }

  jobPicker.addEventListener('change', updateRunButton);

  function renderResumePicker(): void {
    resumePicker.replaceChildren(resumeLegend);
    const available = new Set(resumes.map((resume) => resume.id));
    for (const id of selectedResumeIds) {
      if (!available.has(id)) selectedResumeIds.delete(id);
    }
    if (resumes.length === 0) {
      resumePicker.append(
        createElement(
          'p',
          'capture-card-copy',
          'No resumes yet. Add one in TalentFly, then choose Connect / refresh.',
        ),
      );
    }
    for (const resume of resumes) {
      const label = createElement('label', 'resume-option');
      const checkbox = createElement('input', '');
      checkbox.type = 'checkbox';
      checkbox.value = resume.id;
      checkbox.checked = selectedResumeIds.has(resume.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (selectedResumeIds.size >= 5) {
            checkbox.checked = false;
            handoffError.textContent = 'Select no more than five resumes for one comparison.';
            handoffError.hidden = false;
            return;
          }
          handoffError.hidden = true;
          selectedResumeIds.add(resume.id);
        } else {
          selectedResumeIds.delete(resume.id);
        }
        updateRunButton();
      });
      label.append(checkbox, document.createTextNode(resume.name));
      resumePicker.append(label);
    }
  }

  async function loadPwaData(): Promise<void> {
    if (!bridge.available) {
      handoffStatus.textContent =
        'Open the installed Chrome extension in Chrome, then open the TalentFly PWA to connect.';
      return;
    }
    refreshButton.disabled = true;
    retryButton.disabled = true;
    handoffError.hidden = true;
    recoveryActions.hidden = true;
    handoffStatus.textContent = 'Connecting to the TalentFly PWA…';
    try {
      const ping = await bridge.request(createProtocolMessage('PING', {}));
      if (ping.type !== 'PONG') {
        throw new Error('The TalentFly PWA returned an unexpected readiness response.');
      }
      const [resumeReply, jobReply] = await Promise.all([
        bridge.request(createProtocolMessage('LIST_RESUMES', {})),
        bridge.request(createProtocolMessage('LIST_JOBS', {})),
      ]);
      if (resumeReply.type !== 'RESUMES' || jobReply.type !== 'JOBS') {
        throw new Error('The TalentFly PWA returned invalid resume or job metadata.');
      }
      resumes = resumeReply.payload.resumes;
      savedJobs = jobReply.payload.jobs;
      const previousJobId = jobPicker.value;
      jobPicker.replaceChildren(
        createElement('option', '', 'Choose a saved job'),
        ...savedJobs.map((job) => {
          const option = createElement('option', '', [
            job.title,
            job.company,
            job.location,
          ].filter(Boolean).join(' · '));
          option.value = job.id;
          return option;
        }),
      );
      if (savedJobs.some((job) => job.id === previousJobId)) {
        jobPicker.value = previousJobId;
      }
      renderResumePicker();
      handoffControls.hidden = false;
      handoffStatus.textContent = `Connected · ${savedJobs.length} saved jobs · ${resumes.length} resumes`;
      if (savedJobs.length === 0) {
        handoffError.textContent =
          'No saved jobs yet. Capture a posting above and confirm it in TalentFly.';
        handoffError.hidden = false;
      }
      updateRunButton();
    } catch (error) {
      handoffControls.hidden = true;
      handoffStatus.textContent = 'TalentFly is not connected yet.';
      handoffError.textContent =
        error instanceof Error ? error.message : 'Could not connect to TalentFly.';
      handoffError.hidden = false;
      recoveryActions.hidden = false;
    } finally {
      refreshButton.disabled = false;
      retryButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', () => void loadPwaData());
  retryButton.addEventListener('click', () => void loadPwaData());
  runButton.addEventListener('click', async () => {
    const jobId = jobPicker.value;
    const resumeIds = [...selectedResumeIds];
    if (!jobId || resumeIds.length === 0) {
      updateRunButton();
      return;
    }
    runButton.disabled = true;
    handoffError.hidden = true;
    recoveryActions.hidden = true;
    handoffStatus.textContent = 'Creating a local comparison run…';
    try {
      const response = await bridge.request(
        createProtocolMessage('START_COMPARISON', { jobId, resumeIds }),
      );
      if (response.type !== 'STATUS_UPDATE') {
        throw new Error('TalentFly returned an unexpected comparison status.');
      }
      const { runId, status, error: runError } = response.payload;
      const resultUrl = new URL(pwaOrigin);
      resultUrl.searchParams.set('runId', runId);
      resultUrl.hash = 'inbox';
      const resultLink = createElement('a', 'text-button', 'Open result →');
      resultLink.href = resultUrl.toString();
      resultLink.target = '_blank';
      resultLink.rel = 'noopener noreferrer';
      const runLine = createElement('p', 'capture-status', `Run ${runId} · ${status}`);
      runResult.replaceChildren(runLine, resultLink);
      if (status === 'failed') {
        const failure = createElement('p', 'capture-error', runError ?? 'The comparison run failed.');
        failure.setAttribute('role', 'alert');
        runResult.insertBefore(failure, resultLink);
      }
      runResult.hidden = false;
      handoffStatus.textContent =
        status === 'failed'
          ? 'The comparison run was created but failed.'
          : 'Comparison run created in TalentFly. Open the result to follow its progress.';
    } catch (error) {
      handoffStatus.textContent = 'The comparison run could not be created. Nothing was lost; your selections are kept.';
      handoffError.textContent =
        error instanceof Error ? error.message : 'Could not create a local comparison run.';
      handoffError.hidden = false;
      recoveryActions.hidden = false;
    } finally {
      updateRunButton();
    }
  });
  handoffCard.append(refreshButton, handoffStatus, handoffError, recoveryActions, handoffControls, runResult);
  content.append(handoffCard);
  if (bridge.available) {
    void loadPwaData();
  }

  const openLink = createElement('a', 'open-pwa', 'Open TalentFly');
  const pwaUrl = new URL(pwaOrigin);
  pwaUrl.searchParams.set('extensionVersion', buildInfo.version);
  pwaUrl.searchParams.set('extensionCommit', buildInfo.commit);
  pwaUrl.searchParams.set('extensionBuiltAt', buildInfo.builtAt);
  pwaUrl.hash = 'inbox';
  openLink.href = pwaUrl.toString();
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  const arrow = createElement('span', '', '→');
  arrow.setAttribute('aria-hidden', 'true');
  openLink.append(arrow);

  const footer = createElement('footer', 'popup-footer');
  footer.append(
    createElement('span', 'footer-dot'),
    createElement(
      'span',
      'footer-build',
      `Your workspace stays on this device · Extension v${buildInfo.version} (${buildInfo.commit})`,
    ),
  );

  root.replaceChildren(header, content, openLink, footer);
}
