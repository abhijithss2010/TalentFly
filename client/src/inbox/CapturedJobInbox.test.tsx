import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createProtocolMessage } from '@talentfly/shared';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalDataServices,
  createRecordId,
  type LocalDataServices,
} from '../data/local-data-service';
import { CapturedJobInbox } from './CapturedJobInbox';
import type {
  ExternalExtensionPort,
  ExtensionRuntimeClient,
} from '../services/extension-port';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const databaseNames: string[] = [];
const openedServices: LocalDataServices[] = [];

class MockExtensionPort implements ExternalExtensionPort {
  readonly posted: unknown[] = [];
  readonly messageListeners = new Set<(message: unknown) => void>();
  readonly disconnectListeners = new Set<() => void>();

  postMessage(message: Parameters<ExternalExtensionPort['postMessage']>[0]): void {
    this.posted.push(message);
  }

  onMessage = {
    addListener: (listener: (message: unknown) => void) => this.messageListeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.messageListeners.delete(listener),
  };

  onDisconnect = {
    addListener: (listener: () => void) => this.disconnectListeners.add(listener),
    removeListener: (listener: () => void) => this.disconnectListeners.delete(listener),
  };

  disconnect(): void {
    this.disconnectListeners.forEach((listener) => listener());
  }

  receive(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }
}

function createServiceFactory() {
  const databaseName = `captured-inbox-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  return async () => {
    const services = await createLocalDataServices({ databaseName, indexedDB });
    openedServices.push(services);
    return services;
  };
}

function sendFromExtension(
  source: Window,
  message: ReturnType<typeof createProtocolMessage>,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: message,
      origin: `chrome-extension://${extensionId}`,
      source,
    }),
  );
}

async function removeDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  cleanup();
  openedServices.splice(0).forEach((services) => services.close());
  await Promise.all(databaseNames.splice(0).map(removeDatabase));
  vi.unstubAllGlobals();
});

const capturedJob = {
  title: 'Platform Engineer',
  company: 'Example',
  location: 'Remote',
  sourceUrl: 'https://whoz.com/jobs/1',
  description: 'Build and operate the platform.',
  otherFields: { Reference: 'REF-1' },
};

describe('captured job inbox', () => {
  it('previews extension captures and only persists after explicit confirmation', async () => {
    const serviceFactory = createServiceFactory();
    const sourceFrame = document.createElement('iframe');
    document.body.append(sourceFrame);
    const source = sourceFrame.contentWindow;
    if (!source) {
      throw new Error('Could not create extension message source window.');
    }

    render(
      <CapturedJobInbox extensionId={extensionId} serviceFactory={serviceFactory} />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');

    const capture = createProtocolMessage(
      'JOB_CAPTURED',
      {
        job: {
          title: 'Frontend Engineer',
          company: 'Example Co',
          location: 'Remote',
          sourceUrl: 'https://jobs.example/frontend',
          description: 'Build accessible web applications and collaborate with design.',
        },
      },
      'capture-message-1',
    );
    sendFromExtension(source, capture);

    expect(await screen.findByRole('heading', { name: 'Frontend Engineer' })).toBeTruthy();
    const services = openedServices[0];
    expect(await services.jobs.getAll()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save on this device' }));
    expect(await screen.findByText('Job description saved locally. It has not been sent to an AI provider.'))
      .toBeTruthy();
    expect(await services.jobs.getAll()).toHaveLength(1);

    sendFromExtension(source, capture);
    await waitFor(() => expect(screen.getAllByText('This capture is already saved locally.')).toHaveLength(1));
    expect(await services.jobs.getAll()).toHaveLength(1);
    sourceFrame.remove();
  });

  it('answers resume-list requests with IDs and names only', async () => {
    const serviceFactory = createServiceFactory();
    const sourceFrame = document.createElement('iframe');
    document.body.append(sourceFrame);
    const source = sourceFrame.contentWindow;
    if (!source) {
      throw new Error('Could not create extension message source window.');
    }
    const replies: unknown[] = [];
    const postMessage = vi.spyOn(source, 'postMessage').mockImplementation((message) => {
      replies.push(message);
    });

    render(
      <CapturedJobInbox extensionId={extensionId} serviceFactory={serviceFactory} />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');
    const services = openedServices[0];
    const now = new Date().toISOString();
    await services.resumes.save({
      id: createRecordId('resume'),
      name: 'Engineer',
      fileName: 'engineer.pdf',
      mimeType: 'application/pdf',
      fileSize: 1,
      file: new Blob(['x']),
      extractedText: 'Experience',
      createdAt: now,
      updatedAt: now,
    });

    sendFromExtension(source, createProtocolMessage('LIST_RESUMES', {}, 'list-resumes'));
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(replies[0]).toMatchObject({
      type: 'RESUMES',
      payload: { resumes: [{ id: expect.any(String), name: 'Engineer' }] },
    });
    expect(JSON.stringify(replies[0])).not.toContain('engineer.pdf');
    sourceFrame.remove();
  });

  it('creates a received run for a saved job and selected resumes idempotently', async () => {
    const serviceFactory = createServiceFactory();
    const sourceFrame = document.createElement('iframe');
    document.body.append(sourceFrame);
    const source = sourceFrame.contentWindow;
    if (!source) {
      throw new Error('Could not create extension message source window.');
    }

    render(
      <CapturedJobInbox extensionId={extensionId} serviceFactory={serviceFactory} />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');
    const services = openedServices[0];
    const resume = {
      id: createRecordId('resume'),
      name: 'Resume',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      fileSize: 1,
      file: new Blob(['x']),
      extractedText: 'Experience',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await services.resumes.save(resume);
    const start = createProtocolMessage(
      'START_COMPARISON',
      { job: capturedJob, resumeIds: [resume.id] },
      'start-message-1',
    );

    sendFromExtension(source, start);
    sendFromExtension(source, start);

    await screen.findByText('received', { selector: '.run-status' });
    expect(await services.runs.getAll()).toHaveLength(1);
    const savedJobs = (await services.jobs.getAll()).filter(
      (saved) => saved.captureMessageId === 'start-message-1',
    );
    expect(savedJobs).toHaveLength(1);
    expect(savedJobs[0]).toMatchObject({
      sourceUrl: 'https://whoz.com/jobs/1',
      otherFields: { Reference: 'REF-1' },
    });
    await screen.findByText('Reference');
    await screen.findByText('REF-1');
    sourceFrame.remove();
  });

  it('receives a handoff over the extension port and acknowledges only after the user saves', async () => {
    const port = new MockExtensionPort();
    const runtime: ExtensionRuntimeClient = {
      connect: vi.fn(() => port),
    };
    vi.stubGlobal('chrome', { runtime });

    render(
      <CapturedJobInbox
        extensionId={extensionId}
        serviceFactory={createServiceFactory()}
      />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');
    expect(runtime.connect).toHaveBeenCalledWith(extensionId, {
      name: 'talentfly-protocol-v1',
    });

    const capture = createProtocolMessage(
      'JOB_CAPTURED',
      {
        job: {
          title: 'Systems Engineer',
          company: 'Example',
          location: 'Remote',
          sourceUrl: 'https://jobs.example/systems',
          description: 'Build reliable systems for distributed teams.',
        },
      },
      'port-capture-1',
    );
    port.receive(capture);
    expect(await screen.findByRole('heading', { name: 'Systems Engineer' })).toBeTruthy();
    expect(port.posted).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save on this device' }));
    await screen.findByText('Job description saved locally. It has not been sent to an AI provider.');
    expect(port.posted).toContainEqual(
      expect.objectContaining({
        type: 'CAPTURE_ACK',
        messageId: 'port-capture-1',
        payload: {
          accepted: true,
          jobId: expect.any(String),
        },
      }),
    );
  });

  it('responds to popup resume and job list requests and creates a correlated run', async () => {
    const port = new MockExtensionPort();
    const runtime: ExtensionRuntimeClient = {
      connect: vi.fn(() => port),
    };
    vi.stubGlobal('chrome', { runtime });

    render(
      <CapturedJobInbox
        extensionId={extensionId}
        serviceFactory={createServiceFactory()}
      />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');
    const services = openedServices[0];
    const job = await services.saveCapturedJob({
      id: createRecordId('job'),
      captureMessageId: 'approved-capture-for-popup',
      title: 'Platform Engineer',
      company: 'Example',
      location: 'Remote',
      sourceUrl: 'https://jobs.example/platform',
      description: 'Build reliable platforms.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const resumeId = createRecordId('resume');
    await services.resumes.save({
      id: resumeId,
      name: 'Platform resume',
      fileName: 'platform.pdf',
      mimeType: 'application/pdf',
      fileSize: 1,
      file: new Blob(['x']),
      extractedText: 'Platform experience',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const listResumes = createProtocolMessage('LIST_RESUMES', {}, 'request-resumes');
    port.receive(listResumes);
    await waitFor(() => expect(port.posted).toHaveLength(1));
    expect(port.posted[0]).toMatchObject({
      type: 'RESUMES',
      messageId: listResumes.messageId,
      payload: { resumes: [{ id: resumeId, name: 'Platform resume' }] },
    });

    const listJobs = createProtocolMessage('LIST_JOBS', {}, 'request-jobs');
    port.receive(listJobs);
    await waitFor(() => expect(port.posted).toHaveLength(2));
    expect(port.posted[1]).toMatchObject({
      type: 'JOBS',
      messageId: listJobs.messageId,
      payload: {
        jobs: [{ id: job.id, title: 'Platform Engineer', company: 'Example', location: 'Remote' }],
      },
    });

    const start = createProtocolMessage(
      'START_COMPARISON',
      { job: capturedJob, resumeIds: [resumeId] },
      'request-start',
    );
    port.receive(start);
    await waitFor(() => expect(port.posted).toHaveLength(3));
    expect(port.posted[2]).toMatchObject({
      type: 'STATUS_UPDATE',
      messageId: start.messageId,
      payload: { status: 'received' },
    });
    expect(await services.runs.getAll()).toHaveLength(1);
  });

  it('answers a run that cannot be created with an ERROR reply instead of staying silent', async () => {
    const port = new MockExtensionPort();
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } satisfies ExtensionRuntimeClient });
    render(
      <CapturedJobInbox extensionId={extensionId} serviceFactory={createServiceFactory()} />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');

    const start = createProtocolMessage(
      'START_COMPARISON',
      { job: capturedJob, resumeIds: ['resume_that_was_deleted'] },
      'start-missing-resume',
    );
    port.receive(start);

    await waitFor(() => expect(port.posted).toHaveLength(1));
    expect(port.posted[0]).toMatchObject({
      type: 'ERROR',
      messageId: 'start-missing-resume',
      payload: { code: 'NOT_FOUND', message: expect.stringContaining('no longer available') },
    });
  });

  it('reports an incompatible extension message and answers it with an ERROR reply', async () => {
    const port = new MockExtensionPort();
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } satisfies ExtensionRuntimeClient });
    render(
      <CapturedJobInbox extensionId={extensionId} serviceFactory={createServiceFactory()} />,
    );
    await screen.findByText('No captured jobs have been confirmed yet.');

    port.receive({
      protocolVersion: 2,
      messageId: 'old-start',
      type: 'START_COMPARISON',
      payload: { jobId: 'job_1', resumeIds: ['resume_1'] },
    });

    await screen.findByText(/still uses the old "jobId" field/);
    expect(port.posted).toContainEqual(
      expect.objectContaining({
        type: 'ERROR',
        messageId: 'old-start',
        payload: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      }),
    );
  });
});
