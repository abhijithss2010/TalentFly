import { describe, expect, it } from 'vitest';
import { createProtocolMessage } from '@talentfly/shared';
import { validateExtensionWindowMessage } from './extension-protocol';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const allowedPwaOrigins = ['http://localhost:3000'];

describe('PWA extension message boundary', () => {
  it('validates protocol messages from the configured extension origin', () => {
    const message = createProtocolMessage('PING', {}, 'request_1');
    const event = new MessageEvent('message', {
      data: message,
      origin: `chrome-extension://${extensionId}`,
      source: window,
    });

    expect(validateExtensionWindowMessage(event, extensionId, allowedPwaOrigins)).toEqual(
      message,
    );
  });

  it('rejects wrong extension origins, other windows, and invalid payloads', () => {
    const message = createProtocolMessage('PING', {}, 'request_1');
    const wrongOrigin = new MessageEvent('message', {
      data: message,
      origin: 'https://evil.example',
      source: window,
    });
    expect(() =>
      validateExtensionWindowMessage(wrongOrigin, extensionId, allowedPwaOrigins),
    ).toThrow('not trusted');

    const wrongWindow = new MessageEvent('message', {
      data: message,
      origin: `chrome-extension://${extensionId}`,
    });
    expect(() =>
      validateExtensionWindowMessage(wrongWindow, extensionId, allowedPwaOrigins),
    ).toThrow('did not originate from this page');

    const invalidMessage = new MessageEvent('message', {
      data: { ...message, protocolVersion: 99 },
      origin: `chrome-extension://${extensionId}`,
      source: window,
    });
    expect(() =>
      validateExtensionWindowMessage(invalidMessage, extensionId, allowedPwaOrigins),
    ).toThrow('invalid shape');
  });
});
