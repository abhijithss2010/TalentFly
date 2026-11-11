import { fireEvent, render, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalDataServices } from '../data/local-data-service';
import { CredentialVault } from './credential-vault';
import type { ProviderAdapter } from './provider-adapter';
import { ProviderSettings } from './ProviderSettings';

const databaseNames: string[] = [];

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});

const testAdapter: ProviderAdapter = {
  id: 'claude',
  name: 'Claude (test)',
  models: [
    { id: 'test-sonnet', name: 'Sonnet', description: 'Balanced' },
    { id: 'test-haiku', name: 'Haiku', description: 'Fast' },
  ],
  defaultModel: 'test-sonnet',
  complete: vi.fn(async () => ({ text: 'result', usage: {} })),
  testConnection: vi.fn(async (apiKey, model) => {
    if (apiKey !== 'secret-test-key' || model !== 'test-sonnet') {
      throw new Error('Unexpected provider test arguments.');
    }
  }),
};
const testAdapters = [testAdapter];

function runtimeFactory() {
  const databaseName = `provider-settings-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  return async () => {
    const data = await createLocalDataServices({ databaseName, indexedDB });
    return {
      data,
      credentials: new CredentialVault(data.credentials),
      close: () => data.close(),
    };
  };
}

async function removeDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(removeDatabase));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('provider settings', () => {
  it('saves an encrypted key, verifies provider access, locks, unlocks, and rotates the passphrase', async () => {
    const makeRuntime = runtimeFactory();
    const view = render(
      <ProviderSettings runtimeFactory={makeRuntime} adapters={testAdapters} />,
    );
    await screen.findByText('Choose your AI provider.');

    fireEvent.change(screen.getByLabelText('Active provider'), {
      target: { value: 'claude' },
    });
    fireEvent.change(await screen.findByLabelText('Model'), {
      target: { value: 'test-sonnet' },
    });
    fireEvent.change(await screen.findByLabelText('Claude (test) API key'), {
      target: { value: 'secret-test-key' },
    });
    fireEvent.change(await screen.findByLabelText(/Encryption passphrase/), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.change(await screen.findByLabelText('Confirm passphrase'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Encrypt and save key' }));

    expect(await screen.findByText('Unlocked')).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toContain(
      'Claude (test) API key encrypted and saved on this device.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Verify key and model access' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Connected to Claude (test); model access verified. No message was sent.',
    );
    expect(testAdapter.testConnection).toHaveBeenCalledWith(
      'secret-test-key',
      'test-sonnet',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Lock key' }));
    expect(await screen.findByText('Key saved · locked')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Encryption passphrase'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock key' }));
    expect(await screen.findByText('Unlocked')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Change encryption passphrase'), {
      target: { value: 'new correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change passphrase' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Encryption passphrase changed. Store it safely; it cannot be recovered.',
    );

    view.unmount();
    const runtime = await makeRuntime();
    try {
      expect(await runtime.credentials.hasCredential('claude')).toBe(true);
      expect(runtime.credentials.isUnlocked('claude')).toBe(false);
      const record = await runtime.data.credentials.get('claude');
      expect(JSON.stringify(record)).not.toContain('secret-test-key');
    } finally {
      runtime.close();
    }
  });

  it('rejects mismatched passphrases and keeps Copilot explicitly unavailable', async () => {
    const makeRuntime = runtimeFactory();
    render(
      <ProviderSettings runtimeFactory={makeRuntime} adapters={testAdapters} />,
    );
    await screen.findByText('Choose your AI provider.');

    const providerSelect = screen.getByLabelText('Active provider') as HTMLSelectElement;
    expect([...providerSelect.options].some((option) => option.text.includes('not available yet')))
      .toBe(true);
    fireEvent.change(providerSelect, { target: { value: 'claude' } });

    fireEvent.change(await screen.findByLabelText('Claude (test) API key'), {
      target: { value: 'key' },
    });
    fireEvent.change(await screen.findByLabelText(/Encryption passphrase/), {
      target: { value: 'one secure passphrase' },
    });
    fireEvent.change(await screen.findByLabelText('Confirm passphrase'), {
      target: { value: 'a different passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Encrypt and save key' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The passphrases do not match.',
    );
    expect(testAdapter.testConnection).not.toHaveBeenCalled();
  });
});
