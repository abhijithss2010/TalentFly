import {
  createProtocolMessage,
  validateProtocolMessage,
  type ProtocolMessage,
  type ProtocolMessageType,
  type ProtocolPayloadMap,
} from '@talentfly/shared';

const PORT_NAME = 'talentfly-protocol-v1';
const DEFAULT_RESPONSE_TYPES: Partial<Record<ProtocolMessageType, ProtocolMessageType>> = {
  PING: 'PONG',
  LIST_RESUMES: 'RESUMES',
  LIST_JOBS: 'JOBS',
  START_COMPARISON: 'STATUS_UPDATE',
};

export interface ExternalExtensionPort {
  postMessage(message: ProtocolMessage): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  disconnect(): void;
}

export interface ExtensionRuntimeClient {
  connect(extensionId: string, options: { name: string }): ExternalExtensionPort;
}

export interface ExtensionPortApi {
  runtime?: ExtensionRuntimeClient;
}

export class ExtensionPortClient {
  private readonly port: ExternalExtensionPort;
  private readonly pending = new Map<
    string,
    {
      expectedTypes: ProtocolMessageType[];
      timeout: ReturnType<typeof setTimeout>;
      resolve(message: ProtocolMessage): void;
      reject(error: Error): void;
    }
  >();

  private readonly messageListener = (rawMessage: unknown) => {
    let message: ProtocolMessage;
    try {
      message = validateProtocolMessage(rawMessage);
    } catch {
      return;
    }
    const pending = this.pending.get(message.messageId);
    if (!pending || !pending.expectedTypes.includes(message.type)) {
      this.onUnsolicitedMessage(message);
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.messageId);
    pending.resolve(message);
  };

  private readonly disconnectListener = () => {
    for (const [messageId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(messageId);
      pending.reject(new Error('The TalentFly extension connection was closed.'));
    }
  };

  constructor(
    runtime: ExtensionRuntimeClient,
    extensionId: string,
    private readonly onUnsolicitedMessage: (message: ProtocolMessage) => void = () => undefined,
    private readonly timeoutMs = 15_000,
  ) {
    if (!/^[a-p]{32}$/.test(extensionId)) {
      throw new Error('Configure a valid VITE_TALENTFLY_EXTENSION_ID to connect the extension.');
    }
    this.port = runtime.connect(extensionId, { name: PORT_NAME });
    this.port.onMessage.addListener(this.messageListener);
    this.port.onDisconnect.addListener(this.disconnectListener);
  }

  request<T extends ProtocolMessageType>(
    type: T,
    payload: ProtocolPayloadMap[T],
    expectedType?: ProtocolMessageType,
  ): Promise<ProtocolMessage> {
    const message = createProtocolMessage(type, payload);
    const responseType = expectedType ?? DEFAULT_RESPONSE_TYPES[type];
    if (!responseType) {
      return Promise.reject(new Error(`No response type is defined for "${type}".`));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.messageId);
        reject(new Error('The TalentFly extension did not respond. Reopen the extension and retry.'));
      }, this.timeoutMs);
      this.pending.set(message.messageId, {
        expectedTypes: [responseType],
        timeout,
        resolve,
        reject,
      });
      try {
        this.port.postMessage(message);
      } catch {
        clearTimeout(timeout);
        this.pending.delete(message.messageId);
        reject(new Error('Could not send a message to the TalentFly extension.'));
      }
    });
  }

  postMessage(message: ProtocolMessage): void {
    this.port.postMessage(validateProtocolMessage(message));
  }

  close(): void {
    this.port.onMessage.removeListener(this.messageListener);
    this.port.onDisconnect.removeListener(this.disconnectListener);
    this.disconnectListener();
    this.port.disconnect();
  }
}
