import { describe, expect, it } from 'vitest';
import { createProtocolMessage } from '@talentfly/shared';
import { validateExtensionWindowMessage } from './extension-protocol';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const allowedPwaOrigins = ['http://localhost:3000'];

describe('PWA extension message boundary', () => {
  it('validates protocol messages from the configured extension origin', () => {
    const message = createProtocolMessage('PING', {}, 'request_1');
    const extensionWindow = document.createElement('iframe');
    document.body.append(extensionWindow);
    const event = new MessageEvent('message', {
      data: message,
      origin: `chrome-extension://${extensionId}`,
      source: extensionWindow.contentWindow,
    });

    expect(validateExtensionWindowMessage(event, extensionId, allowedPwaOrigins)).toMatchObject({
      message,
      targetOrigin: `chrome-extension://${extensionId}`,
    });
    extensionWindow.remove();
  });

  it('rejects wrong extension origins, other windows, and invalid payloads', () => {
    const message = createProtocolMessage('PING', {}, 'request_1');
    const extensionWindow = document.createElement('iframe');
    document.body.append(extensionWindow);
    const wrongOrigin = new MessageEvent('message', {
      data: message,
      origin: 'https://evil.example',
      source: extensionWindow.contentWindow,
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
    ).toThrow('separate extension window');

    const invalidMessage = new MessageEvent('message', {
      data: { ...message, protocolVersion: 99 },
      origin: `chrome-extension://${extensionId}`,
      source: extensionWindow.contentWindow,
    });
    expect(() =>
      validateExtensionWindowMessage(invalidMessage, extensionId, allowedPwaOrigins),
    ).toThrow('Unsupported protocol version 99');
    extensionWindow.remove();
  });
});
