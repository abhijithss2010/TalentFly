import {
  PROTOCOL_VERSION,
  validatePwaMessage,
  validateProtocolMessage,
  type ProtocolMessage,
  type ProtocolMessageType,
} from '@talentfly/shared';
import { resolvePwaOrigin } from './pwa-origin';

const PORT_NAME = 'talentfly-protocol-v1';
const RELAY_CHANNEL = 'talentfly-popup-relay-v1';
const REQUEST_TIMEOUT_MS = 15_000;

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

function isHello(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channel' in value &&
    value.channel === RELAY_CHANNEL &&
    'hello' in value &&
    value.hello === true
  );
}

/** Every request may also be answered with ERROR when the PWA rejects or fails it. */
function expectedResponseTypes(type: ProtocolMessageType): ProtocolMessageType[] {
  switch (type) {
    case 'PING':
      return ['PONG', 'ERROR'];
    case 'LIST_RESUMES':
      return ['RESUMES', 'ERROR'];
    case 'LIST_JOBS':
      return ['JOBS', 'ERROR'];
    case 'START_COMPARISON':
    case 'GET_RUN_STATUS':
    case 'LATEST_RUN_FOR_URL':
      return ['STATUS_UPDATE', 'ERROR'];
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
      { protocolVersion: 3, messageId: 'validation', type: 'PING', payload: {} },
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
  if (sender.id !== expectedExtensionId) {
    return false;
  }
  if (isHello(rawRequest)) {
    sendResponse({ hello: true, protocolVersion: PROTOCOL_VERSION });
    return false;
  }
  if (!isRelayRequest(rawRequest)) {
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
