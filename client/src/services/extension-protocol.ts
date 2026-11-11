import {
  validateExtensionMessage,
  type MessageSender,
  type ProtocolMessage,
} from '@talentfly/shared';

export function validateExtensionWindowMessage(
  event: MessageEvent<unknown>,
  extensionId: string,
  allowedPwaOrigins: readonly string[],
): { message: ProtocolMessage; source: Window; targetOrigin: string } {
  if (!event.source || event.source === window) {
    throw new Error('The extension message did not originate from a separate extension window.');
  }

  const sender: MessageSender = {
    origin: event.origin,
    extensionId: event.origin.startsWith('chrome-extension://')
      ? event.origin.slice('chrome-extension://'.length)
      : undefined,
    pageOrigin: window.location.origin,
  };
  return {
    message: validateExtensionMessage(event.data, sender, extensionId, allowedPwaOrigins),
    source: event.source as Window,
    targetOrigin: event.origin,
  };
}
