// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPopup } from '../src/popup-ui';
import type { JobCapture } from '../src/job-capture';
import { UnsupportedSiteError } from '../src/supported-site';
import { createProtocolMessage, type ProtocolMessage } from '@talentfly/shared';

const buildInfo = { version: '0.1.0', commit: 'abc123', builtAt: '2026-11-11T00:00:00.000Z' };
const ORIGIN = 'https://talentfly.example';
const capture: JobCapture = {
  title: 'Frontend Engineer',
  company: 'Example Co',
  location: 'Remote',
  sourceUrl: 'https://whoz.com/jobs/123',
  description: 'Build accessible web applications.',
  descriptionTruncated: false,
  otherFields: { Reference: 'REF-7' },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FakePwa {
  reachable: boolean;
  resumes: { id: string; name: string }[];
  startReply?: (message: ProtocolMessage) => ProtocolMessage;
  calls: ProtocolMessage[];
}

function bridgeFor(pwa: FakePwa) {
  return {
    available: true,
    async request(message: ProtocolMessage): Promise<ProtocolMessage> {
      pwa.calls.push(message);
      if (!pwa.reachable) throw new Error('Open the TalentFly PWA, then retry this action.');
      switch (message.type) {
        case 'PING':
          return createProtocolMessage('PONG', { ready: true }, message.messageId);
        case 'LIST_RESUMES':
          return createProtocolMessage('RESUMES', { resumes: pwa.resumes }, message.messageId);
        case 'START_COMPARISON':
          return (
            pwa.startReply?.(message) ??
            createProtocolMessage(
              'STATUS_UPDATE',
              { runId: 'run_1', status: 'received' },
              message.messageId,
            )
          );
        default:
          throw new Error(`Unexpected ${message.type}`);
      }
    },
  };
}

describe('extension popup', () => {
  let root: HTMLElement;
  let pwa: FakePwa;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) throw new Error('Missing test application root');
    root = app;
    pwa = {
      reachable: true,
      resumes: [
        { id: 'resume_1', name: 'Frontend resume' },
        { id: 'resume_2', name: 'Backend resume' },
      ],
      calls: [],
    };
  });

  const runButton = () => root.querySelector<HTMLButtonElement>('.primary-button');
  const resumeSelect = () => root.querySelector<HTMLSelectElement>('select[name="resume"]');
  const choose = (id: string) => {
    const select = resumeSelect();
    if (select) {
      select.value = id;
      select.dispatchEvent(new Event('change'));
    }
  };
  const connectionState = () => root.querySelector<HTMLElement>('.connection-bar')?.dataset.state;

  it('has no capture button, preview, or manual send flow', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();

    expect(root.textContent).not.toContain('Capture this page');
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('input[type="text"]')).toBeNull();
    expect(root.textContent).not.toContain('Send to TalentFly');
  });

  it('shows PWA status and a refresh button at the top, connecting on open', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    expect(root.firstElementChild?.nextElementSibling?.className).toBe('connection-bar');
    expect(connectionState()).toBe('checking');
    await flush();

    expect(connectionState()).toBe('connected');
    expect(root.querySelector('.connection-text')?.textContent).toBe('TalentFly connected');
    expect(root.querySelector('.connection-refresh')?.textContent).toBe('Refresh');
  });

  it('extracts automatically on open and shows the values read-only', async () => {
    const extract = vi.fn(async () => capture);
    renderPopup(root, ORIGIN, buildInfo, extract, bridgeFor(pwa));
    expect(extract).toHaveBeenCalledTimes(1);
    await flush();

    const values = [...root.querySelectorAll('.job-field-value')].map((node) => node.textContent);
    expect(values).toEqual(['Frontend Engineer', 'Example Co', 'Remote', 'REF-7']);
    const labels = [...root.querySelectorAll('.job-field-label')].map((node) => node.textContent);
    expect(labels).toEqual(['Title', 'Company', 'Location', 'Reference']);
    expect(root.querySelector('.job-description-text')?.textContent).toBe(capture.description);
    // The page URL is sent to the PWA but not displayed in the popup.
    expect(root.textContent).not.toContain('whoz.com/jobs/123');
  });

  it('explains pages outside whoz.com and offers no run action', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => {
      throw new UnsupportedSiteError(['whoz.com']);
    }, bridgeFor(pwa));
    await flush();

    expect(root.querySelector('.card-error:not([hidden])')?.textContent).toContain('whoz.com');
    expect(root.querySelector<HTMLElement>('.job-fields')?.hidden).toBe(true);
    const runCard = [...root.querySelectorAll<HTMLElement>('.card')].find((card) =>
      card.textContent?.includes('Compare with'),
    );
    expect(runCard?.hidden).toBe(true);
  });

  it('offers a retry when extraction fails on a whoz.com page', async () => {
    let attempts = 0;
    renderPopup(root, ORIGIN, buildInfo, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('No visible job description was found on this page.');
      return capture;
    }, bridgeFor(pwa));
    await flush();

    const retry = root.querySelector<HTMLButtonElement>('.secondary-button');
    expect(retry?.hidden).toBe(false);
    retry?.click();
    await flush();
    expect(root.querySelector('.job-field-value')?.textContent).toBe('Frontend Engineer');
  });

  it('uses a single-choice dropdown with the first resume selected by default', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();

    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
    const options = [...(resumeSelect()?.options ?? [])].map((option) => [option.value, option.text]);
    expect(options).toEqual([
      ['resume_1', 'Frontend resume'],
      ['resume_2', 'Backend resume'],
    ]);
    expect(resumeSelect()?.value).toBe('resume_1');
    expect(resumeSelect()?.multiple).toBe(false);
    expect(runButton()?.disabled).toBe(false);
  });

  it('keeps the run button disabled while extraction is pending or the PWA is disconnected', async () => {
    let finish: (value: JobCapture) => void = () => undefined;
    renderPopup(
      root,
      ORIGIN,
      buildInfo,
      () => new Promise<JobCapture>((resolve) => (finish = resolve)),
      bridgeFor(pwa),
    );
    await flush();
    expect(connectionState()).toBe('connected');
    expect(runButton()?.disabled).toBe(true);
    finish(capture);
    await flush();
    expect(runButton()?.disabled).toBe(false);

    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>('#app') as HTMLElement;
    pwa.reachable = false;
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    expect(connectionState()).toBe('disconnected');
    expect(root.querySelector('.connection-refresh')?.textContent).toBe('Connect');
    expect(runButton()?.disabled).toBe(true);
    expect(root.querySelector<HTMLAnchorElement>('.connection-hint a')?.href).toBe(
      `${ORIGIN}/#inbox`,
    );
  });

  it('connects when the PWA becomes available and defaults to the first resume', async () => {
    pwa.reachable = false;
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    expect(connectionState()).toBe('disconnected');

    pwa.reachable = true;
    root.querySelector<HTMLButtonElement>('.connection-refresh')?.click();
    await flush();
    expect(connectionState()).toBe('connected');
    expect(resumeSelect()?.value).toBe('resume_1');
  });

  it('refresh keeps the chosen resume if it still exists, otherwise falls back to the first', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    choose('resume_2');
    pwa.resumes = [{ id: 'resume_2', name: 'Backend resume' }, { id: 'resume_3', name: 'New' }];
    root.querySelector<HTMLButtonElement>('.connection-refresh')?.click();
    await flush();
    expect(resumeSelect()?.value).toBe('resume_2');

    pwa.resumes = [{ id: 'resume_3', name: 'New' }, { id: 'resume_4', name: 'Other' }];
    root.querySelector<HTMLButtonElement>('.connection-refresh')?.click();
    await flush();
    expect(resumeSelect()?.value).toBe('resume_3');
    expect(runButton()?.disabled).toBe(false);
  });

  it('shows an empty-resume message and keeps the run disabled', async () => {
    pwa.resumes = [];
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    expect(root.textContent).toContain('No resumes yet.');
    expect(runButton()?.disabled).toBe(true);
  });

  it('sends the extracted job and exactly the chosen resume, then links to the run', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    choose('resume_2');
    runButton()?.click();
    await flush();

    const start = pwa.calls.at(-1);
    expect(start).toMatchObject({
      type: 'START_COMPARISON',
      payload: {
        job: {
          title: 'Frontend Engineer',
          company: 'Example Co',
          location: 'Remote',
          sourceUrl: capture.sourceUrl,
          description: capture.description,
          otherFields: { Reference: 'REF-7' },
        },
        resumeIds: ['resume_2'],
      },
    });
    expect(root.textContent).toContain('Run run_1 · received');
    const link = root.querySelector<HTMLAnchorElement>('.run-result a');
    const url = new URL(link?.href ?? '');
    expect(url.searchParams.get('runId')).toBe('run_1');
    expect(url.hash).toBe('#inbox');
    expect(link?.rel).toContain('noopener');
  });

  it('reuses the same message ID when retrying so a run cannot be duplicated', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    pwa.startReply = () => {
      throw new Error('The TalentFly PWA did not respond in time. Retry the action.');
    };
    runButton()?.click();
    await flush();
    expect(root.querySelector('.run-result')?.textContent).toBe('');
    expect(root.querySelector('.card-error:not([hidden])')?.textContent).toContain('did not respond');
    expect(connectionState()).toBe('disconnected');

    pwa.startReply = undefined;
    root.querySelector<HTMLButtonElement>('.connection-refresh')?.click();
    await flush();
    runButton()?.click();
    await flush();

    const starts = pwa.calls.filter((call) => call.type === 'START_COMPARISON');
    expect(starts).toHaveLength(2);
    expect(starts[1].messageId).toBe(starts[0].messageId);

    // A different resume is a different run, so it gets a new message ID.
    choose('resume_2');
    runButton()?.click();
    await flush();
    const latest = pwa.calls.filter((call) => call.type === 'START_COMPARISON').at(-1);
    expect(latest?.messageId).not.toBe(starts[0].messageId);
  });

  it('shows a failed run status with its error', async () => {
    pwa.startReply = (message) =>
      createProtocolMessage(
        'STATUS_UPDATE',
        { runId: 'run_9', status: 'failed', error: 'Provider key is missing.' },
        message.messageId,
      );
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    runButton()?.click();
    await flush();

    expect(root.querySelector('.run-result [role="alert"]')?.textContent).toBe(
      'Provider key is missing.',
    );
    expect(root.querySelector<HTMLAnchorElement>('.run-result a')?.href).toContain('runId=run_9');
  });

  it('re-reads the page right before creating the run and sends the fresh values', async () => {
    let version = 0;
    const extract = vi.fn(async () => {
      version += 1;
      return version === 1
        ? capture
        : { ...capture, title: 'Updated title', otherFields: { Reference: 'REF-8' } };
    });
    renderPopup(root, ORIGIN, buildInfo, extract, bridgeFor(pwa));
    await flush();
    runButton()?.click();
    await flush();

    expect(extract).toHaveBeenCalledTimes(2);
    expect(pwa.calls.at(-1)).toMatchObject({
      type: 'START_COMPARISON',
      payload: { job: { title: 'Updated title', otherFields: { Reference: 'REF-8' } } },
    });
    expect(root.querySelector('.job-field-value')?.textContent).toBe('Updated title');
  });

  it('does not send anything when the pre-run re-read fails', async () => {
    let calls = 0;
    const extract = vi.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error('The job description was not found on this whoz.com page.');
      return capture;
    });
    renderPopup(root, ORIGIN, buildInfo, extract, bridgeFor(pwa));
    await flush();
    runButton()?.click();
    await flush();

    expect(pwa.calls.some((call) => call.type === 'START_COMPARISON')).toBe(false);
    expect(root.querySelector('.card-error:not([hidden])')?.textContent).toContain('description was not found');
  });

  it('shows an actionable message when the extension background worker is out of date', async () => {
    const bridge = {
      ...bridgeFor(pwa),
      checkWorker: async () => {
        throw new Error('The TalentFly extension background worker is out of date or not running. Reload TalentFly on chrome://extensions, then reopen this popup.');
      },
    };
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridge);
    await flush();

    expect(connectionState()).toBe('disconnected');
    expect(root.querySelector('.connection-error')?.textContent).toContain('Reload TalentFly on chrome://extensions');
    expect(pwa.calls).toEqual([]);
    expect(runButton()?.disabled).toBe(true);
  });

  it('shows the reason a connection failed and keeps the Open TalentFly link', async () => {
    pwa.reachable = false;
    renderPopup(root, ORIGIN, buildInfo, async () => capture, bridgeFor(pwa));
    await flush();
    expect(root.querySelector('.connection-error')?.textContent).toContain('Open the TalentFly PWA');
    expect(root.querySelector<HTMLAnchorElement>('.connection-hint a')?.href).toBe(`${ORIGIN}/#inbox`);
    expect(root.querySelector<HTMLElement>('.connection-hint')?.hidden).toBe(false);
  });

  it('shows the PWA ERROR message when the run is rejected', async () => {
    renderPopup(root, ORIGIN, buildInfo, async () => capture, {
      ...bridgeFor(pwa),
      async request(message: ProtocolMessage) {
        if (message.type === 'START_COMPARISON') {
          throw new Error('One or more selected resumes are no longer available.');
        }
        return bridgeFor(pwa).request(message);
      },
    });
    await flush();
    runButton()?.click();
    await flush();
    expect(root.querySelector('.card-error:not([hidden])')?.textContent).toContain('no longer available');
  });
});
