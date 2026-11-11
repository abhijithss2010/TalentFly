import {
  normalizeAllowedPwaOrigins,
  validatePwaMessage,
  type ProtocolMessage,
} from '@talentfly/shared';

export interface PwaRuntimeSender {
  id?: string;
  origin?: string;
  url?: string;
}

function originFromSender(sender: PwaRuntimeSender): string {
  if (typeof sender.origin === 'string') {
    return sender.origin;
  }
  if (typeof sender.url === 'string') {
    try {
      return new URL(sender.url).origin;
    } catch {
      throw new Error('The PWA message sender has an invalid origin.');
    }
  }
  throw new Error('The PWA message sender did not provide an origin.');
}

export function validateIncomingPwaMessage(
  value: unknown,
  sender: PwaRuntimeSender,
  extensionId: string,
  allowedPwaOrigins: readonly string[],
): ProtocolMessage {
  const allowedOrigins = normalizeAllowedPwaOrigins(allowedPwaOrigins);
  return validatePwaMessage(
    value,
    { origin: originFromSender(sender), extensionId: sender.id },
    extensionId,
    [extensionId],
    allowedOrigins,
  );
}
