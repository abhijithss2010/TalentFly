import { describe, expect, it, vi } from 'vitest';
import { createProtocolMessage } from '@talentfly/shared';
import {
  queueCaptureAndOpenPwa,
  relayToPwa,
  type ExtensionRuntime,
} from '../src/extension-transport';

describe('extension transport', () => {
  it('relays only protocol-validated requests and rejects an unconnected PWA', async () => {
    let response: unknown;
    const runtime: ExtensionRuntime = {
      sendMessage: vi.fn((_message, callback) => callback(response)),
    };
    const request = createProtocolMessage('PING', {}, 'ping_1');
    response = createProtocolMessage('PONG', { ready: true }, 'ping_1');

    await expect(relayToPwa(runtime, request)).resolves.toMatchObject({
      type: 'PONG',
      messageId: 'ping_1',
    });

    response = { error: 'PWA_NOT_CONNECTED' };
    await expect(relayToPwa(runtime, request)).rejects.toThrow(
      'Open the TalentFly PWA, then retry this action.',
    );
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      { channel: 'talentfly-popup-relay-v1', request },
      expect.any(Function),
    );
  });

  it('stores the reviewed capture for the current browser session and opens only the PWA inbox', async () => {
    const storage = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    };
    const tabs = { create: vi.fn(async () => undefined) };
    const job = {
      title: 'Engineer',
      company: 'Example',
      location: 'Remote',
      sourceUrl: 'https://jobs.example/engineer',
      description: 'Build reliable systems.',
      descriptionTruncated: false,
    };

    await queueCaptureAndOpenPwa({ storage: { session: storage }, tabs }, 'https://talentfly.example', job);

    expect(storage.set).toHaveBeenCalledWith({
      talentflyPendingCapture: expect.objectContaining({
        message: expect.objectContaining({
          type: 'JOB_CAPTURED',
          payload: { job: expect.not.objectContaining({ descriptionTruncated: expect.anything() }) },
        }),
        createdAt: expect.any(Number),
      }),
    });
    expect(tabs.create).toHaveBeenCalledWith({
      url: 'https://talentfly.example/#inbox',
      active: true,
    });
  });

  it('does not silently overwrite an unacknowledged capture', async () => {
    const storage = {
      get: vi.fn(async () => ({
        talentflyPendingCapture: { createdAt: Date.now(), message: {} },
      })),
      set: vi.fn(async () => undefined),
    };
    const tabs = { create: vi.fn(async () => undefined) };

    await expect(
      queueCaptureAndOpenPwa(
        { storage: { session: storage }, tabs },
        'https://talentfly.example',
        {
          title: 'Engineer',
          company: '',
          location: '',
          sourceUrl: 'https://jobs.example/engineer',
          description: 'Build reliable systems.',
        },
      ),
    ).rejects.toThrow('A capture is already waiting for review in TalentFly.');
    expect(storage.set).not.toHaveBeenCalled();
    expect(tabs.create).not.toHaveBeenCalled();
  });
});
