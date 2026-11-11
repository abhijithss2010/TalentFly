import { describe, expect, it } from 'vitest';
import { createProtocolMessage } from '@talentfly/shared';
import { validateIncomingPwaMessage } from '../src/protocol';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const allowedPwaOrigins = ['http://localhost:5173'];

describe('extension PWA message boundary', () => {
  it('accepts a valid message from a configured PWA origin', () => {
    const message = createProtocolMessage('LIST_RESUMES', {}, 'list_1');

    expect(
      validateIncomingPwaMessage(
        message,
        { url: 'http://localhost:5173/#dashboard' },
        extensionId,
        allowedPwaOrigins,
      ),
    ).toEqual(message);
  });

  it('rejects non-allow-listed origins and mismatched extension identities', () => {
    const message = createProtocolMessage('PING', {}, 'ping_1');

    expect(() =>
      validateIncomingPwaMessage(
        message,
        { origin: 'https://attacker.example' },
        extensionId,
        allowedPwaOrigins,
      ),
    ).toThrow('not trusted');

    expect(() =>
      validateIncomingPwaMessage(
        message,
        { origin: 'http://localhost:5173', id: 'ponmlkjihgfedcbaponmlkjihgfedcba' },
        extensionId,
        allowedPwaOrigins,
      ),
    ).toThrow('not trusted');

    expect(() =>
      validateIncomingPwaMessage(
        { ...message, protocolVersion: 4 },
        { origin: 'http://localhost:5173' },
        extensionId,
        allowedPwaOrigins,
      ),
    ).toThrow('Unsupported protocol version 4');
  });
});
