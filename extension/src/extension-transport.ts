import {
  createProtocolMessage,
  validateProtocolMessage,
  type CapturedJob,
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

export async function relayToPwa(
  runtime: ExtensionRuntime,
  message: ProtocolMessage,
): Promise<ProtocolMessage> {
  validateProtocolMessage(message);
  const response = await new Promise<unknown>((resolve, reject) => {
    runtime.sendMessage({ channel: RELAY_CHANNEL, request: message }, (result) => {
      if (runtime.lastError) {
        reject(new Error(runtime.lastError.message ?? 'The TalentFly PWA could not be reached.'));
        return;
      }
      resolve(result);
    });
  });

  if (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    response.error === 'PWA_NOT_CONNECTED'
  ) {
    throw new Error('Open the TalentFly PWA, then retry this action.');
  }
  if (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof response.error === 'string'
  ) {
    throw new Error(response.error);
  }
  return validateProtocolMessage(response);
}

export interface ChromeStorageSession {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeTabs {
  create(createProperties: { url: string; active?: boolean }): Promise<unknown>;
}

export interface PendingCaptureBrowserApi {
  storage: { session: ChromeStorageSession };
  tabs: ChromeTabs;
}

export async function queueCaptureAndOpenPwa(
  browser: PendingCaptureBrowserApi,
  pwaOrigin: string,
  job: CapturedJob,
): Promise<void> {
  const stored = await browser.storage.session.get('talentflyPendingCapture');
  const existing = stored.talentflyPendingCapture as { createdAt?: unknown } | undefined;
  if (
    existing &&
    typeof existing.createdAt === 'number' &&
    Date.now() - existing.createdAt < 30 * 60 * 1000
  ) {
    throw new Error(
      'A capture is already waiting for review in TalentFly. Open the PWA before sending another.',
    );
  }

  const message = createProtocolMessage('JOB_CAPTURED', {
    job: {
      title: job.title,
      company: job.company,
      location: job.location,
      sourceUrl: job.sourceUrl,
      description: job.description,
    },
  });
  await browser.storage.session.set({
    talentflyPendingCapture: { message, createdAt: Date.now() },
  });
  const target = new URL(pwaOrigin);
  target.hash = 'inbox';
  await browser.tabs.create({ url: target.toString(), active: true });
}

export const extensionRelayChannel = RELAY_CHANNEL;
