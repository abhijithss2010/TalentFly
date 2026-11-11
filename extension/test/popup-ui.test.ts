// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPopup } from '../src/popup-ui';
import type { JobCapture } from '../src/job-capture';
import {
  createProtocolMessage,
  type ProtocolMessage,
} from '@talentfly/shared';

describe('extension popup', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) throw new Error('Missing test application root');
    root = app;
  });

  it('shows branding, capture action, and the configured PWA link', () => {
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    });

    expect(root.querySelector('h1')?.textContent).toBe('Make your next move count.');
    expect(root.textContent).toContain('The editable preview stays here and is not sent or saved.');
    expect(root.querySelector('.capture-button')?.textContent).toBe('Capture this page');
    expect(root.querySelector('.capture-preview')?.hasAttribute('hidden')).toBe(true);

    const link = root.querySelector<HTMLAnchorElement>('.open-pwa');
    const url = new URL(link?.href ?? '');
    expect(url.origin).toBe('https://talentfly.example');
    expect(url.hash).toBe('#inbox');
    expect(url.searchParams.get('extensionVersion')).toBe('0.1.0');
    expect(url.searchParams.get('extensionCommit')).toBe('abc123');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
  });

  it('captures on explicit click and shows an editable preview without sending it', async () => {
    const capture: JobCapture = {
      title: 'Frontend Engineer',
      company: 'Example Co',
      location: 'Remote',
      sourceUrl: 'https://jobs.example/123',
      description: 'Build accessible web applications.',
      descriptionTruncated: false,
    };
    let captureCalls = 0;
    const sendCapture = vi.fn(async () => undefined);
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    }, async () => {
      captureCalls += 1;
      return capture;
    }, {
      available: false,
      request: async () => {
        throw new Error('not used');
      },
      sendCapture,
    });

    expect(captureCalls).toBe(0);
    root.querySelector<HTMLButtonElement>('.capture-button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(captureCalls).toBe(1);
    expect(root.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(capture.title);
    expect(root.querySelector<HTMLInputElement>('input[name="company"]')?.value).toBe(capture.company);
    expect(root.querySelector<HTMLInputElement>('input[name="location"]')?.value).toBe(capture.location);
    expect(root.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value).toBe(
      capture.description,
    );
    expect(root.textContent).toContain(`Source page: ${capture.sourceUrl}`);
    expect(root.textContent).toContain('Preview ready. Edit any field before using it.');
    expect(root.querySelector('form')).toBeNull();

    const title = root.querySelector<HTMLInputElement>('input[name="title"]');
    const description = root.querySelector<HTMLTextAreaElement>('textarea[name="description"]');
    if (title) {
      title.value = 'Updated role title';
      title.dispatchEvent(new Event('input'));
    }
    if (description) {
      description.value = 'Reviewed job description';
      description.dispatchEvent(new Event('input'));
    }
    root.querySelector<HTMLButtonElement>('.send-capture-button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendCapture).toHaveBeenCalledWith(
      'https://talentfly.example',
      expect.objectContaining({
        title: 'Updated role title',
        description: 'Reviewed job description',
      }),
    );
  });

  it('shows capture errors and never leaves a success-shaped empty preview', async () => {
    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    }, async () => {
      throw new Error('This page does not allow capture. Open a regular webpage and try again.');
    });

    root.querySelector<HTMLButtonElement>('.capture-button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'This page does not allow capture.',
    );
    expect(root.querySelector('.capture-preview')?.hasAttribute('hidden')).toBe(true);
  });

  it('loads PWA job/resume metadata, validates selections, creates a run, and links to it', async () => {
    const calls: ProtocolMessage[] = [];
    const bridge = {
      available: true,
      async sendCapture() {},
      async request(message: ProtocolMessage): Promise<ProtocolMessage> {
        calls.push(message);
        switch (message.type) {
          case 'PING':
            return createProtocolMessage('PONG', { ready: true }, message.messageId);
          case 'LIST_RESUMES':
            return createProtocolMessage(
              'RESUMES',
              { resumes: [{ id: 'resume_1', name: 'Frontend resume' }] },
              message.messageId,
            );
          case 'LIST_JOBS':
            return createProtocolMessage(
              'JOBS',
              { jobs: [{ id: 'job_1', title: 'Frontend Engineer', company: 'Example Co' }] },
              message.messageId,
            );
          case 'START_COMPARISON':
            return createProtocolMessage(
              'STATUS_UPDATE',
              { runId: 'run_1', status: 'received' },
              message.messageId,
            );
          default:
            throw new Error(`Unexpected message ${message.type}`);
        }
      },
    };

    renderPopup(root, 'https://talentfly.example', {
      version: '0.1.0',
      commit: 'abc123',
      builtAt: '2026-11-11T00:00:00.000Z',
    }, undefined, bridge);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Connected · 1 saved jobs · 1 resumes');
    expect(root.textContent).toContain('Frontend resume');

    const resumeCheckbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(resumeCheckbox?.value).toBe('resume_1');
    resumeCheckbox?.click();
    const jobSelect = root.querySelector<HTMLSelectElement>('select[name="saved-job"]');
    if (jobSelect) {
      jobSelect.value = 'job_1';
      jobSelect.dispatchEvent(new Event('change'));
    }

    const runButton = root.querySelector<HTMLButtonElement>('.handoff-controls .button-primary');
    expect(runButton?.disabled).toBe(false);
    runButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.at(-1)).toMatchObject({
      type: 'START_COMPARISON',
      payload: { jobId: 'job_1', resumeIds: ['resume_1'] },
    });
    expect(root.textContent).toContain('Run run_1 · received');
    const runLink = root.querySelector<HTMLAnchorElement>('.run-result a');
    const runUrl = new URL(runLink?.href ?? '');
    expect(runUrl.searchParams.get('runId')).toBe('run_1');
    expect(runUrl.hash).toBe('#inbox');
  });

  const buildInfo = { version: '0.1.0', commit: 'abc123', builtAt: '2026-11-11T00:00:00.000Z' };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('offers an explicit open and retry action when the PWA is unreachable, then recovers', async () => {
    let reachable = false;
    const request = vi.fn(async (message: ProtocolMessage): Promise<ProtocolMessage> => {
      if (!reachable) throw new Error('Open the TalentFly PWA, then retry this action.');
      switch (message.type) {
        case 'PING':
          return createProtocolMessage('PONG', { ready: true }, message.messageId);
        case 'LIST_RESUMES':
          return createProtocolMessage('RESUMES', { resumes: [{ id: 'resume_1', name: 'CV' }] }, message.messageId);
        case 'LIST_JOBS':
          return createProtocolMessage('JOBS', { jobs: [{ id: 'job_1', title: 'Engineer' }] }, message.messageId);
        default:
          throw new Error(`Unexpected ${message.type}`);
      }
    });
    renderPopup(root, 'https://talentfly.example', buildInfo, undefined, {
      available: true,
      request,
      async sendCapture() {},
    });
    await flush();

    expect(root.querySelector('.handoff-card [role="alert"]')?.textContent).toContain('Open the TalentFly PWA');
    const recovery = root.querySelector<HTMLElement>('.recovery-actions');
    expect(recovery?.hidden).toBe(false);
    expect(root.querySelector<HTMLAnchorElement>('.recovery-actions a')?.href).toBe(
      'https://talentfly.example/#inbox',
    );
    expect(root.querySelector<HTMLElement>('.handoff-controls')?.hidden).toBe(true);

    reachable = true;
    root.querySelector<HTMLButtonElement>('.recovery-actions button')?.click();
    await flush();
    expect(root.textContent).toContain('Connected · 1 saved jobs · 1 resumes');
    expect(root.querySelector<HTMLElement>('.recovery-actions')?.hidden).toBe(true);
  });

  it('requires a resume selection and keeps selections when run creation fails', async () => {
    const request = vi.fn(async (message: ProtocolMessage): Promise<ProtocolMessage> => {
      switch (message.type) {
        case 'PING':
          return createProtocolMessage('PONG', { ready: true }, message.messageId);
        case 'LIST_RESUMES':
          return createProtocolMessage('RESUMES', { resumes: [{ id: 'resume_1', name: 'CV' }] }, message.messageId);
        case 'LIST_JOBS':
          return createProtocolMessage('JOBS', { jobs: [{ id: 'job_1', title: 'Engineer' }] }, message.messageId);
        case 'START_COMPARISON':
          throw new Error('The TalentFly PWA did not respond in time. Retry the action.');
        default:
          throw new Error(`Unexpected ${message.type}`);
      }
    });
    renderPopup(root, 'https://talentfly.example', buildInfo, undefined, {
      available: true,
      request,
      async sendCapture() {},
    });
    await flush();

    const jobSelect = root.querySelector<HTMLSelectElement>('select[name="saved-job"]');
    const runButton = root.querySelector<HTMLButtonElement>('.handoff-controls .button-primary');
    if (jobSelect) {
      jobSelect.value = 'job_1';
      jobSelect.dispatchEvent(new Event('change'));
    }
    expect(runButton?.disabled).toBe(true);

    root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    expect(runButton?.disabled).toBe(false);
    runButton?.click();
    await flush();

    expect(root.querySelector('.handoff-card [role="alert"]')?.textContent).toContain('did not respond in time');
    expect(root.querySelector<HTMLElement>('.recovery-actions')?.hidden).toBe(false);
    expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(runButton?.disabled).toBe(false);
    expect(root.querySelector<HTMLElement>('.run-result')?.hidden).toBe(true);
  });

  it('surfaces a failed run status with its error and still links to the run', async () => {
    const request = vi.fn(async (message: ProtocolMessage): Promise<ProtocolMessage> => {
      switch (message.type) {
        case 'PING':
          return createProtocolMessage('PONG', { ready: true }, message.messageId);
        case 'LIST_RESUMES':
          return createProtocolMessage('RESUMES', { resumes: [{ id: 'resume_1', name: 'CV' }] }, message.messageId);
        case 'LIST_JOBS':
          return createProtocolMessage('JOBS', { jobs: [{ id: 'job_1', title: 'Engineer' }] }, message.messageId);
        case 'START_COMPARISON':
          return createProtocolMessage(
            'STATUS_UPDATE',
            { runId: 'run_9', status: 'failed', error: 'Provider key is missing.' },
            message.messageId,
          );
        default:
          throw new Error(`Unexpected ${message.type}`);
      }
    });
    renderPopup(root, 'https://talentfly.example', buildInfo, undefined, {
      available: true,
      request,
      async sendCapture() {},
    });
    await flush();
    const jobSelect = root.querySelector<HTMLSelectElement>('select[name="saved-job"]');
    if (jobSelect) {
      jobSelect.value = 'job_1';
      jobSelect.dispatchEvent(new Event('change'));
    }
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    root.querySelector<HTMLButtonElement>('.handoff-controls .button-primary')?.click();
    await flush();

    expect(root.querySelector('.run-result [role="alert"]')?.textContent).toBe('Provider key is missing.');
    expect(new URL(root.querySelector<HTMLAnchorElement>('.run-result a')?.href ?? '').searchParams.get('runId')).toBe('run_9');
  });
});
