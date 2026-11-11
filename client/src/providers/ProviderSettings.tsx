import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppSettingsRecord, ProviderId } from '../data/models';
import type { ProviderAdapter } from './provider-adapter';
import {
  createProviderRuntime,
  providerRegistry,
  type ProviderRuntime,
} from './provider-runtime';
import { MIN_PASSPHRASE_LENGTH } from './credential-vault';

interface ProviderSettingsProps {
  runtimeFactory?: () => Promise<ProviderRuntime>;
  adapters?: readonly ProviderAdapter[];
}

const AVAILABLE_ADAPTERS = providerRegistry.list();

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The provider settings action failed.';
}

function defaultSettings(): AppSettingsRecord {
  const now = new Date().toISOString();
  return {
    id: 'app',
    defaultResumeId: null,
    preferredProvider: null,
    providerModels: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function ProviderSettings({
  runtimeFactory = createProviderRuntime,
  adapters = AVAILABLE_ADAPTERS,
}: ProviderSettingsProps) {
  const runtimeRef = useRef<ProviderRuntime | null>(null);
  const [settings, setSettings] = useState<AppSettingsRecord>(defaultSettings);
  const [savedProviders, setSavedProviders] = useState<ProviderId[]>([]);
  const [unlockedProviders, setUnlockedProviders] = useState<ProviderId[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedProvider = adapters.find((adapter) => adapter.id === settings.preferredProvider);
  const selectedProviderId = selectedProvider?.id;
  const selectedIsSaved = selectedProviderId
    ? savedProviders.includes(selectedProviderId)
    : false;
  const selectedIsUnlocked = selectedProviderId
    ? unlockedProviders.includes(selectedProviderId)
    : false;
  const selectedModel = selectedProvider
    ? settings.providerModels?.[selectedProvider.id] ?? selectedProvider.defaultModel
    : '';

  useEffect(() => {
    let active = true;
    let runtime: ProviderRuntime | null = null;
    void runtimeFactory()
      .then(async (openedRuntime) => {
        runtime = openedRuntime;
        if (!active) {
          openedRuntime.close();
          return;
        }
        runtimeRef.current = openedRuntime;
        const [storedSettings, credentials] = await Promise.all([
          openedRuntime.data.settings.get('app'),
          Promise.all(adapters.map((adapter) =>
            openedRuntime.credentials.hasCredential(adapter.id).then((exists) => ({
              id: adapter.id,
              exists,
            })),
          )),
        ]);
        if (!active) {
          return;
        }
        const initialSettings = storedSettings ?? defaultSettings();
        if (!storedSettings) {
          await openedRuntime.data.settings.save(initialSettings);
        }
        setSettings(initialSettings);
        setSavedProviders(credentials.filter((item) => item.exists).map((item) => item.id));
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(messageFrom(loadError));
          setLoading(false);
        }
      });

    return () => {
      active = false;
      runtime?.credentials.lock();
      runtime?.close();
      runtimeRef.current = null;
    };
  }, [runtimeFactory, adapters]);

  useEffect(() => {
    const lockWhenHidden = () => {
      if (document.visibilityState !== 'hidden') {
        return;
      }
      runtimeRef.current?.credentials.lock();
      setUnlockedProviders([]);
      setApiKey('');
      setPassphrase('');
      setConfirmPassphrase('');
      setNewPassphrase('');
    };
    document.addEventListener('visibilitychange', lockWhenHidden);
    return () => document.removeEventListener('visibilitychange', lockWhenHidden);
  }, []);

  async function saveSettings(next: AppSettingsRecord): Promise<void> {
    const runtime = runtimeRef.current;
    if (!runtime) {
      throw new Error('Provider settings are not available.');
    }
    const updated = { ...next, updatedAt: new Date().toISOString() };
    await runtime.data.settings.save(updated);
    setSettings(updated);
  }

  function showError(actionError: unknown): void {
    setNotice(null);
    setError(messageFrom(actionError));
  }

  async function selectProvider(providerId: ProviderId | null): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (settings.preferredProvider && settings.preferredProvider !== providerId) {
        runtimeRef.current?.credentials.lock(settings.preferredProvider);
        setUnlockedProviders((current) =>
          current.filter((id) => id !== settings.preferredProvider),
        );
      }
      await saveSettings({ ...settings, preferredProvider: providerId });
      setPassphrase('');
      setConfirmPassphrase('');
      setApiKey('');
      setNewPassphrase('');
    } catch (saveError) {
      showError(saveError);
    } finally {
      setBusy(false);
    }
  }

  function providerIdFromSelection(value: string): ProviderId | null {
    if (value === '') {
      return null;
    }
    const adapter = adapters.find((item) => item.id === value);
    if (adapter) {
      return adapter.id;
    }
    setError('That provider is not available in this version of TalentFly.');
    return settings.preferredProvider;
  }

  async function selectModel(model: string): Promise<void> {
    if (!selectedProvider) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveSettings({
        ...settings,
        providerModels: { ...settings.providerModels, [selectedProvider.id]: model },
      });
      setNotice(`${selectedProvider.name} model preference saved.`);
    } catch (saveError) {
      showError(saveError);
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const runtime = runtimeRef.current;
    if (!runtime || !selectedProvider) {
      return;
    }
    if (!apiKey.trim()) {
      setError('Enter an API key before saving.');
      return;
    }
    if (!selectedIsSaved && passphrase !== confirmPassphrase) {
      setError('The passphrases do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (selectedIsSaved) {
        await runtime.credentials.replaceApiKey(selectedProvider.id, apiKey);
      } else {
        await runtime.credentials.save(selectedProvider.id, apiKey, passphrase);
        setSavedProviders((current) => [...current, selectedProvider.id]);
        setUnlockedProviders((current) => [...current, selectedProvider.id]);
      }
      setApiKey('');
      setPassphrase('');
      setConfirmPassphrase('');
      setNotice(`${selectedProvider.name} API key encrypted and saved on this device.`);
    } catch (saveError) {
      showError(saveError);
    } finally {
      setBusy(false);
    }
  }

  async function unlockCredential(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const runtime = runtimeRef.current;
    if (!runtime || !selectedProvider) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await runtime.credentials.unlock(selectedProvider.id, passphrase);
      setUnlockedProviders((current) =>
        current.includes(selectedProvider.id) ? current : [...current, selectedProvider.id],
      );
      setPassphrase('');
      setNotice(`${selectedProvider.name} is unlocked for this app session.`);
    } catch (unlockError) {
      showError(unlockError);
    } finally {
      setBusy(false);
    }
  }

  async function lockCredential(): Promise<void> {
    const runtime = runtimeRef.current;
    if (!runtime || !selectedProvider) {
      return;
    }
    runtime.credentials.lock(selectedProvider.id);
    setUnlockedProviders((current) => current.filter((id) => id !== selectedProvider.id));
    setApiKey('');
    setNewPassphrase('');
    setNotice('Provider key locked.');
    setError(null);
  }

  async function changePassphrase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const runtime = runtimeRef.current;
    if (!runtime || !selectedProvider) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await runtime.credentials.changePassphrase(selectedProvider.id, newPassphrase);
      setNewPassphrase('');
      setNotice('Encryption passphrase changed. Store it safely; it cannot be recovered.');
    } catch (changeError) {
      showError(changeError);
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential(): Promise<void> {
    const runtime = runtimeRef.current;
    if (!runtime || !selectedProvider) {
      return;
    }
    if (!window.confirm(`Remove the saved ${selectedProvider.name} API key from this device?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await runtime.credentials.remove(selectedProvider.id);
      setSavedProviders((current) => current.filter((id) => id !== selectedProvider.id));
      setUnlockedProviders((current) => current.filter((id) => id !== selectedProvider.id));
      setPassphrase('');
      setApiKey('');
      setNotice(`${selectedProvider.name} API key removed from this device.`);
    } catch (removeError) {
      showError(removeError);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    const runtime = runtimeRef.current;
    if (!runtime || !selectedProvider || !selectedIsUnlocked) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await runtime.credentials.withApiKey(selectedProvider.id, (key) =>
        selectedProvider.testConnection(key, selectedModel),
      );
      setNotice(`Connected to ${selectedProvider.name}; model access verified. No message was sent.`);
    } catch (connectionError) {
      showError(connectionError);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <section className="settings-panel" role="status">Opening local provider settings…</section>;
  }

  return (
    <section className="provider-settings" aria-labelledby="provider-settings-heading">
      <header className="provider-settings-header">
        <p className="eyebrow">YOUR PREFERENCES</p>
        <h2 id="provider-settings-heading">Choose your AI provider.</h2>
        <p className="muted-copy">
          Provider keys are encrypted on this device. A key is used only when you explicitly
          start a request to that provider.
        </p>
      </header>

      {error && <div className="provider-message provider-message-error" role="alert">{error}</div>}
      {notice && <div className="provider-message provider-message-success" role="status">{notice}</div>}

      <div className="provider-layout">
        <div className="settings-panel provider-choice-panel">
          <label htmlFor="provider-select">Active provider</label>
          <select
            disabled={busy}
            id="provider-select"
            value={settings.preferredProvider ?? ''}
            onChange={(event) =>
              void selectProvider(providerIdFromSelection(event.currentTarget.value))
            }
          >
            <option value="">Choose a provider</option>
            {adapters.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>{adapter.name}</option>
            ))}
            {!adapters.some((adapter) => adapter.id === 'copilot') && (
              <option disabled value="copilot">GitHub Copilot (not available yet)</option>
            )}
          </select>
          <p>
            Credentials are never sent to TalentFly servers, written to the URL, or included in
            local data exports. The selected provider receives only data you send in a future
            comparison.
          </p>
        </div>

        {selectedProvider ? (
          <div className="settings-panel provider-detail-panel">
            <div className="provider-panel-heading">
              <div>
                <p className="eyebrow">PROVIDER SETTINGS</p>
                <h3>{selectedProvider.name}</h3>
              </div>
              <span className={`provider-key-status${selectedIsUnlocked ? ' provider-key-unlocked' : ''}`}>
                {selectedIsSaved ? (selectedIsUnlocked ? 'Unlocked' : 'Key saved · locked') : 'No key saved'}
              </span>
            </div>

            <label htmlFor="provider-model">Model</label>
            <select
              disabled={busy}
              id="provider-model"
              value={selectedModel}
              onChange={(event) => void selectModel(event.currentTarget.value)}
            >
              {selectedProvider.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} — {model.description}
                </option>
              ))}
            </select>

            {selectedIsSaved && !selectedIsUnlocked && (
              <form className="provider-form" onSubmit={(event) => void unlockCredential(event)}>
                <label htmlFor="provider-unlock-passphrase">Encryption passphrase</label>
                <input
                  autoComplete="current-password"
                  id="provider-unlock-passphrase"
                  required
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.currentTarget.value)}
                />
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? 'Unlocking…' : 'Unlock key'}
                </button>
              </form>
            )}

            {(!selectedIsSaved || selectedIsUnlocked) && (
              <form className="provider-form" onSubmit={(event) => void saveCredential(event)}>
                <label htmlFor="provider-api-key">{selectedIsSaved ? 'Replace API key' : `${selectedProvider.name} API key`}</label>
                <input
                  autoComplete="off"
                  id="provider-api-key"
                  name="provider-api-key"
                  required
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                />
                {!selectedIsSaved && (
                  <>
                    <label htmlFor="provider-new-passphrase">
                      Encryption passphrase (at least {MIN_PASSPHRASE_LENGTH} characters)
                    </label>
                    <input
                      autoComplete="new-password"
                      id="provider-new-passphrase"
                      required
                      type="password"
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.currentTarget.value)}
                    />
                    <label htmlFor="provider-confirm-passphrase">Confirm passphrase</label>
                    <input
                      autoComplete="new-password"
                      id="provider-confirm-passphrase"
                      required
                      type="password"
                      value={confirmPassphrase}
                      onChange={(event) => setConfirmPassphrase(event.currentTarget.value)}
                    />
                    <p className="provider-security-note">
                      There is no password reset. If you forget this passphrase, remove the
                      saved key and enter it again.
                    </p>
                  </>
                )}
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? 'Saving…' : selectedIsSaved ? 'Encrypt and replace key' : 'Encrypt and save key'}
                </button>
              </form>
            )}

            {selectedIsUnlocked && (
              <div className="provider-actions">
                <button className="button button-secondary" disabled={busy} onClick={() => void testConnection()}>
                  {busy ? 'Checking…' : 'Verify key and model access'}
                </button>
                <button className="text-button" disabled={busy} onClick={() => void lockCredential()}>
                  Lock key
                </button>
                <form className="provider-change-passphrase" onSubmit={(event) => void changePassphrase(event)}>
                  <label htmlFor="provider-rotate-passphrase">Change encryption passphrase</label>
                  <input
                    autoComplete="new-password"
                    id="provider-rotate-passphrase"
                    minLength={MIN_PASSPHRASE_LENGTH}
                    required
                    type="password"
                    value={newPassphrase}
                    onChange={(event) => setNewPassphrase(event.currentTarget.value)}
                  />
                  <button className="text-button" disabled={busy} type="submit">
                    Change passphrase
                  </button>
                </form>
                <button className="text-button text-button-danger" disabled={busy} onClick={() => void removeCredential()}>
                  Remove saved key
                </button>
              </div>
            )}

            <p className="provider-security-note">
              Encryption at rest does not protect a key while this browser session is unlocked
              or from malicious code running on this origin. Claude requests go directly from
              your browser to Anthropic; browser SDK use requires opting in to browser access.
            </p>
          </div>
        ) : (
          <div className="settings-panel provider-unavailable">
            <span className="resume-empty-icon" aria-hidden="true">+</span>
            <h3>Select an available provider</h3>
            <p>Additional provider adapters can be registered without changing credential storage or the settings interface.</p>
          </div>
        )}
      </div>
    </section>
  );
}
