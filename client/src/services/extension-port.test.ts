import { describe, expect, it, vi } from 'vitest';
import { createProtocolMessage } from '@talentfly/shared';
import {
  ExtensionPortClient,
  type ExternalExtensionPort,
  type ExtensionRuntimeClient,
} from './extension-port';

class MockPort implements ExternalExtensionPort {
  readonly posted: unknown[] = [];
  readonly messageListeners = new Set<(message: unknown) => void>();
  readonly disconnectListeners = new Set<() => void>();
  disconnected = false;

  postMessage(message: unknown): void {
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
    this.disconnected = true;
    this.disconnectListeners.forEach((listener) => listener());
  }

  receive(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }
}

function createRuntime(port: MockPort): ExtensionRuntimeClient {
  return {
    connect: vi.fn(() => port),
  };
}

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

describe('PWA extension port client', () => {
  it('sends versioned requests and matches responses by message ID and type', async () => {
    const port = new MockPort();
    const client = new ExtensionPortClient(createRuntime(port), extensionId, undefined, 100);

    const request = client.request('LIST_JOBS', {});
    const sent = port.posted[0];
    expect(sent).toMatchObject({ type: 'LIST_JOBS', payload: {} });

    const messageId = (sent as { messageId: string }).messageId;
    const response = createProtocolMessage(
      'JOBS',
      { jobs: [{ id: 'job_1', title: 'Engineer' }] },
      messageId,
    );
    port.receive(response);

    await expect(request).resolves.toEqual(response);
    client.close();
    expect(port.disconnected).toBe(true);
  });

  it('delivers unsolicited validated captures and rejects malformed port messages', () => {
    const port = new MockPort();
    const onUnsolicited = vi.fn();
    const onInvalid = vi.fn();
    const client = new ExtensionPortClient(
      createRuntime(port),
      extensionId,
      onUnsolicited,
      15_000,
      onInvalid,
    );
    const capture = createProtocolMessage(
      'JOB_CAPTURED',
      {
        job: {
          title: 'Engineer',
          company: '',
          location: '',
          sourceUrl: 'https://jobs.example/engineer',
          description: 'Build reliable systems for customers.',
        },
      },
      'capture_1',
    );

    port.receive(capture);
    port.receive({ ...capture, protocolVersion: 99 });

    expect(onInvalid).toHaveBeenCalledWith(
      expect.objectContaining({ protocolVersion: 99 }),
      expect.objectContaining({ message: expect.stringContaining('Unsupported protocol version 99') }),
    );
    expect(onUnsolicited).toHaveBeenCalledTimes(1);
    expect(onUnsolicited).toHaveBeenCalledWith(capture);
    client.close();
  });

  it('rejects pending requests when the extension disconnects', async () => {
    const port = new MockPort();
    const client = new ExtensionPortClient(createRuntime(port), extensionId);
    const request = client.request('PING', {});

    port.disconnect();

    await expect(request).rejects.toThrow('The TalentFly extension connection was closed.');
  });
});
