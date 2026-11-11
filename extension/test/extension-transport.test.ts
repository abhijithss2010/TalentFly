import { describe, expect, it, vi } from 'vitest';
import { createProtocolMessage } from '@talentfly/shared';
import {
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
});
