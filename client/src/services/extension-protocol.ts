import {
  validateExtensionMessage,
  type MessageSender,
  type ProtocolMessage,
} from '@talentfly/shared';

export function validateExtensionWindowMessage(
  event: MessageEvent<unknown>,
  extensionId: string,
  allowedPwaOrigins: readonly string[],
): ProtocolMessage {
  if (event.source !== window) {
    throw new Error('The extension message did not originate from this page window.');
  }

  const sender: MessageSender = {
    origin: event.origin,
    extensionId: event.origin.startsWith('chrome-extension://')
      ? event.origin.slice('chrome-extension://'.length)
      : undefined,
    pageOrigin: window.location.origin,
  };
  return validateExtensionMessage(event.data, sender, extensionId, allowedPwaOrigins);
}
