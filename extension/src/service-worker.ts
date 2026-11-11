import {
  validatePwaMessage,
  validateProtocolMessage,
  type ProtocolMessage,
  type ProtocolMessageType,
} from '@talentfly/shared';
import { resolvePwaOrigin } from './pwa-origin';

const PORT_NAME = 'talentfly-protocol-v1';
const RELAY_CHANNEL = 'talentfly-popup-relay-v1';
const REQUEST_TIMEOUT_MS = 15_000;
const PENDING_CAPTURE_KEY = 'talentflyPendingCapture';

const configuredOrigin = import.meta.env.VITE_TALENTFLY_PWA_ORIGIN;
const pwaOrigin = resolvePwaOrigin(configuredOrigin, import.meta.env.MODE);
const expectedExtensionId = chrome.runtime.id;

interface PendingRequest {
  port: chrome.runtime.Port;
  expectedTypes: ProtocolMessageType[];
  timeout: ReturnType<typeof setTimeout>;
  resolve(message: ProtocolMessage): void;
  reject(error: Error): void;
}

const pwaPorts = new Set<chrome.runtime.Port>();
const pendingRequests = new Map<string, PendingRequest>();

function isRelayRequest(value: unknown): value is {
  channel: typeof RELAY_CHANNEL;
  request: ProtocolMessage;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channel' in value &&
    value.channel === RELAY_CHANNEL &&
    'request' in value
  );
}

function expectedResponseTypes(type: ProtocolMessageType): ProtocolMessageType[] {
  switch (type) {
    case 'PING':
      return ['PONG'];
    case 'LIST_RESUMES':
      return ['RESUMES'];
    case 'LIST_JOBS':
      return ['JOBS'];
    case 'JOB_CAPTURED':
      return ['CAPTURE_ACK'];
    case 'START_COMPARISON':
      return ['STATUS_UPDATE'];
    default:
      return [];
  }
}

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== PORT_NAME || !port.sender) {
    port.disconnect();
    return;
  }

  try {
    validatePwaMessage(
      { protocolVersion: 1, messageId: 'validation', type: 'PING', payload: {} },
      {
        origin: port.sender.origin ?? new URL(port.sender.url ?? '').origin,
        extensionId: port.sender.id,
      },
      expectedExtensionId,
      [expectedExtensionId],
      [pwaOrigin],
    );
  } catch {
    port.disconnect();
    return;
  }

  pwaPorts.add(port);
  void chrome.storage.session.get(PENDING_CAPTURE_KEY).then((stored) => {
    const pending = stored[PENDING_CAPTURE_KEY] as
      | { createdAt: number; message: ProtocolMessage }
      | undefined;
    if (!pending) {
      return;
    }
    if (Date.now() - pending.createdAt > 30 * 60 * 1000) {
      void chrome.storage.session.remove(PENDING_CAPTURE_KEY);
      return;
    }
    try {
      port.postMessage(validateProtocolMessage(pending.message));
    } catch {
      // The service worker will retry the still-pending capture on the next PWA connection.
    }
  });
  port.onMessage.addListener((rawMessage: unknown) => {
    let message: ProtocolMessage;
    try {
      message = validatePwaMessage(
        rawMessage,
        {
          origin: port.sender?.origin ?? new URL(port.sender?.url ?? '').origin,
          extensionId: port.sender?.id,
        },
        expectedExtensionId,
        [expectedExtensionId],
        [pwaOrigin],
      );
    } catch {
      return;
    }

    if (message.type === 'CAPTURE_ACK') {
      void chrome.storage.session.get(PENDING_CAPTURE_KEY).then((stored) => {
        const pending = stored[PENDING_CAPTURE_KEY] as
          | { message: ProtocolMessage }
          | undefined;
        if (pending?.message.messageId === message.messageId) {
          return chrome.storage.session.remove(PENDING_CAPTURE_KEY);
        }
      });
    }

    const pending = pendingRequests.get(message.messageId);
    if (!pending || pending.port !== port || !pending.expectedTypes.includes(message.type)) {
      return;
    }
    clearTimeout(pending.timeout);
    pendingRequests.delete(message.messageId);
    pending.resolve(message);
  });
  port.onDisconnect.addListener(() => {
    pwaPorts.delete(port);
    for (const [messageId, pending] of pendingRequests) {
      if (pending.port === port) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(messageId);
        pending.reject(new Error('The TalentFly PWA connection was closed.'));
      }
    }
  });
});

chrome.runtime.onMessage.addListener((rawRequest, sender, sendResponse) => {
  if (sender.id !== expectedExtensionId || !isRelayRequest(rawRequest)) {
    return false;
  }

  let request: ProtocolMessage;
  try {
    request = validateProtocolMessage(rawRequest.request);
  } catch (error) {
    sendResponse({
      error: error instanceof Error ? error.message : 'The protocol request is invalid.',
    });
    return false;
  }

  const responseTypes = expectedResponseTypes(request.type);
  if (responseTypes.length === 0) {
    sendResponse({ error: `The "${request.type}" message cannot be sent by the popup.` });
    return false;
  }

  const port = [...pwaPorts].find((candidate) => {
    try {
      const origin =
        candidate.sender?.origin ?? new URL(candidate.sender?.url ?? '').origin;
      return origin === pwaOrigin;
    } catch {
      return false;
    }
  });
  if (!port) {
    sendResponse({ error: 'PWA_NOT_CONNECTED' });
    return false;
  }

  const timeout = setTimeout(() => {
    pendingRequests.delete(request.messageId);
    sendResponse({ error: 'The TalentFly PWA did not respond in time. Retry the action.' });
  }, REQUEST_TIMEOUT_MS);
  pendingRequests.set(request.messageId, {
    port,
    expectedTypes: responseTypes,
    timeout,
    resolve: sendResponse,
    reject: (error) => sendResponse({ error: error.message }),
  });

  try {
    port.postMessage(request);
  } catch {
    clearTimeout(timeout);
    pendingRequests.delete(request.messageId);
    sendResponse({ error: 'The TalentFly PWA connection could not send the request.' });
  }
  return true;
});
