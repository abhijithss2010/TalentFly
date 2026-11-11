import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProtocolMessage, type ProtocolMessage } from '@talentfly/shared';
import {
  checkRelayWorker,
  PwaRequestError,
  relayToPwa,
  type ExtensionRuntime,
} from '../src/extension-transport';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PWA_ORIGIN = 'http://localhost:5173';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Listener = (...args: any[]) => unknown;

/** Wires the real service worker to a fake Chrome and a fake PWA port. */
async function startServiceWorker() {
  const onConnectExternal: Listener[] = [];
  const onMessage: Listener[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      onConnectExternal: { addListener: (l: Listener) => onConnectExternal.push(l) },
      onMessage: { addListener: (l: Listener) => onMessage.push(l) },
    },
  });
  vi.resetModules();
  await import('../src/service-worker');

  const toPwa: ProtocolMessage[] = [];
  const portMessageListeners: Listener[] = [];
  const port = {
    name: 'talentfly-protocol-v1',
    sender: { origin: PWA_ORIGIN, url: `${PWA_ORIGIN}/`, id: undefined },
    postMessage: (message: ProtocolMessage) => toPwa.push(clone(message)),
    onMessage: { addListener: (l: Listener) => portMessageListeners.push(l) },
    onDisconnect: { addListener: () => undefined },
    disconnect: vi.fn(),
  };
  onConnectExternal[0](port);

  // The popup's chrome.runtime, delivering through JSON like real extension messaging.
  const popupRuntime: ExtensionRuntime = {
    sendMessage(message, callback) {
      const result = onMessage[0](clone(message), { id: EXTENSION_ID }, (response: unknown) =>
        callback(response === undefined ? undefined : clone(response)),
      );
      if (result !== true) callback(undefined);
    },
  };
  return {
    popupRuntime,
    toPwa,
    pwaSends: (message: ProtocolMessage) => portMessageListeners[0](clone(message)),
    port,
  };
}

const job = {
  title: 'Senior Platform Engineer',
  company: '',
  location: 'Paris, Remote',
  sourceUrl: 'https://app.whoz.com/jobs/42',
  description: 'Own the deployment platform.',
  otherFields: { Reference: 'REF-1' },
};

describe('popup ⇄ service worker ⇄ PWA contract', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('relays START_COMPARISON to the PWA and returns its STATUS_UPDATE', async () => {
    const sw = await startServiceWorker();
    const request = createProtocolMessage('START_COMPARISON', {
      job,
      resumeIds: ['resume_1'],
    });
    const pending = relayToPwa(sw.popupRuntime, request);

    expect(sw.toPwa).toEqual([request]);
    sw.pwaSends(
      createProtocolMessage(
        'STATUS_UPDATE',
        { runId: 'run_9', status: 'received' },
        request.messageId,
      ),
    );

    await expect(pending).resolves.toMatchObject({
      type: 'STATUS_UPDATE',
      payload: { runId: 'run_9', status: 'received' },
    });
  });

  it('returns the PWA ERROR reply as a readable failure instead of timing out', async () => {
    const sw = await startServiceWorker();
    const request = createProtocolMessage('START_COMPARISON', { job, resumeIds: ['resume_1'] });
    const pending = relayToPwa(sw.popupRuntime, request);
    sw.pwaSends(
      createProtocolMessage(
        'ERROR',
        { code: 'NOT_FOUND', message: 'One or more selected resumes are no longer available.' },
        request.messageId,
      ),
    );
    await expect(pending).rejects.toThrow('no longer available');
  });

  it('rejects an invalid request with the specific field instead of a generic shape error', async () => {
    const sw = await startServiceWorker();
    const bad = {
      protocolVersion: 3,
      messageId: 'bad',
      type: 'START_COMPARISON',
      payload: { jobId: 'job_1', resumeIds: ['resume_1'] },
    } as unknown as ProtocolMessage;
    const response = await new Promise<unknown>((resolve) =>
      sw.popupRuntime.sendMessage(
        { channel: 'talentfly-popup-relay-v1', request: bad },
        resolve,
      ),
    );
    expect(response).toEqual({ error: expect.stringContaining('still uses the old "jobId" field') });
    expect(sw.toPwa).toEqual([]);
  });

  it('answers the popup handshake with the worker protocol version', async () => {
    const sw = await startServiceWorker();
    await expect(checkRelayWorker(sw.popupRuntime)).resolves.toBeUndefined();
  });

  it('reports an out-of-date worker that does not know the handshake', async () => {
    const silentWorker: ExtensionRuntime = {
      sendMessage: (_message, callback) => callback(undefined),
    };
    await expect(checkRelayWorker(silentWorker)).rejects.toThrow(
      'Reload TalentFly on chrome://extensions',
    );

    const closedPort: ExtensionRuntime = {
      sendMessage: (_message, callback) => callback(undefined),
      lastError: { message: 'The message port closed before a response was received.' },
    };
    await expect(checkRelayWorker(closedPort)).rejects.toThrow('out of date or not running');

    const oldProtocol: ExtensionRuntime = {
      sendMessage: (_message, callback) => callback({ hello: true, protocolVersion: 1 }),
    };
    await expect(checkRelayWorker(oldProtocol)).rejects.toThrow('speaks protocol version 1');
  });

  it('turns an empty worker response into the out-of-date message, not a validation error', async () => {
    const emptyWorker: ExtensionRuntime = {
      sendMessage: (_message, callback) => callback(undefined),
    };
    await expect(
      relayToPwa(emptyWorker, createProtocolMessage('PING', {})),
    ).rejects.toThrow('out of date or not running');
  });

  it.each([
    ['GET_RUN_STATUS', { runId: 'run_9' }],
    ['LATEST_RUN_FOR_URL', { sourceUrl: 'https://app.whoz.com/jobs/42#top' }],
  ] as const)('relays %s to the PWA and returns its STATUS_UPDATE', async (type, payload) => {
    const sw = await startServiceWorker();
    const request = createProtocolMessage(type, payload as never);
    const pending = relayToPwa(sw.popupRuntime, request);

    expect(sw.toPwa).toEqual([request]);
    sw.pwaSends(
      createProtocolMessage(
        'STATUS_UPDATE',
        { runId: 'run_9', status: 'failed', error: 'Claude rate-limited the request.' },
        request.messageId,
      ),
    );
    await expect(pending).resolves.toMatchObject({
      type: 'STATUS_UPDATE',
      payload: { runId: 'run_9', status: 'failed', error: 'Claude rate-limited the request.' },
    });
  });

  it('keeps the ERROR code so "no run yet" can be told apart from a real failure', async () => {
    const sw = await startServiceWorker();
    const request = createProtocolMessage('LATEST_RUN_FOR_URL', {
      sourceUrl: 'https://app.whoz.com/jobs/404',
    });
    const pending = relayToPwa(sw.popupRuntime, request);
    sw.pwaSends(
      createProtocolMessage(
        'ERROR',
        { code: 'NOT_FOUND', message: 'No comparison has been started for this page yet.' },
        request.messageId,
      ),
    );

    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PwaRequestError);
    expect(failure).toMatchObject({
      code: 'NOT_FOUND',
      message: 'No comparison has been started for this page yet.',
    });
  });
});
