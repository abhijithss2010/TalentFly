import {
  PROTOCOL_VERSION,
  validateProtocolMessage,
  type ProtocolMessage,
} from '@talentfly/shared';

const RELAY_CHANNEL = 'talentfly-popup-relay-v1';

export interface ExtensionRuntime {
  sendMessage(
    message: unknown,
    callback: (response: unknown) => void,
  ): void;
  lastError?: { message?: string };
}

const OUTDATED_WORKER_MESSAGE =
  'The TalentFly extension background worker is out of date or not running. Reload TalentFly on chrome://extensions, then reopen this popup.';

function sendToWorker(runtime: ExtensionRuntime, message: unknown): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    runtime.sendMessage(message, (result) => {
      if (runtime.lastError) {
        reject(new Error(runtime.lastError.message ?? OUTDATED_WORKER_MESSAGE));
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Confirms the background worker speaks this popup's protocol version. A worker from an older
 * build does not know the handshake and never answers, which is reported as out of date.
 */
export async function checkRelayWorker(runtime: ExtensionRuntime): Promise<void> {
  let response: unknown;
  try {
    response = await sendToWorker(runtime, { channel: RELAY_CHANNEL, hello: true });
  } catch {
    throw new Error(OUTDATED_WORKER_MESSAGE);
  }
  if (
    typeof response !== 'object' ||
    response === null ||
    !('protocolVersion' in response)
  ) {
    throw new Error(OUTDATED_WORKER_MESSAGE);
  }
  if (response.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `The extension background worker speaks protocol version ${String(response.protocolVersion)} but this popup needs ${PROTOCOL_VERSION}. Reload TalentFly on chrome://extensions, then reopen this popup.`,
    );
  }
}

export async function relayToPwa(
  runtime: ExtensionRuntime,
  message: ProtocolMessage,
): Promise<ProtocolMessage> {
  validateProtocolMessage(message);
  const response = await sendToWorker(runtime, { channel: RELAY_CHANNEL, request: message });

  if (response === undefined || response === null) {
    throw new Error(OUTDATED_WORKER_MESSAGE);
  }
  if (typeof response === 'object' && 'error' in response) {
    if (response.error === 'PWA_NOT_CONNECTED') {
      throw new Error('Open the TalentFly PWA, then retry this action.');
    }
    if (typeof response.error === 'string') {
      throw new Error(response.error);
    }
  }
  const reply = validateProtocolMessage(response);
  if (reply.type === 'ERROR') {
    throw new Error(reply.payload.message);
  }
  return reply;
}

export const extensionRelayChannel = RELAY_CHANNEL;
