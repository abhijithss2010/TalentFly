import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncryptedCredentialRecord, ProviderId } from '../data/models';
import type { EntityRepository } from '../data/local-data-service';
import {
  CredentialVault,
  CREDENTIAL_FORMAT,
  MIN_PASSPHRASE_LENGTH,
} from './credential-vault';

class MemoryRepository implements EntityRepository<EncryptedCredentialRecord> {
  private readonly records = new Map<string, EncryptedCredentialRecord>();

  async get(id: string) {
    return this.records.get(id as ProviderId);
  }

  async getAll() {
    return [...this.records.values()];
  }

  async save(record: EncryptedCredentialRecord) {
    this.records.set(record.id, structuredClone(record));
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

describe('credential vault', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encrypts credentials, unlocks only with the right passphrase, and locks in memory', async () => {
    const repository = new MemoryRepository();
    const vault = new CredentialVault(repository);

    await expect(vault.save('claude', '  secret-api-key  ', 'a secure passphrase'))
      .resolves.toBeUndefined();
    const stored = await repository.get('claude');

    expect(stored).toMatchObject({
      id: 'claude',
      format: CREDENTIAL_FORMAT,
    });
    expect(JSON.stringify(stored)).not.toContain('secret-api-key');
    expect(vault.isUnlocked('claude')).toBe(true);

    vault.lock();
    expect(vault.isUnlocked('claude')).toBe(false);
    await expect(
      vault.withApiKey('claude', async () => 'should not execute'),
    ).rejects.toThrow('Unlock this provider before using its API key.');
    await expect(vault.unlock('claude', 'wrong passphrase')).rejects.toThrow(
      'Could not unlock this key. Check your passphrase or remove and re-add the key.',
    );
    expect(vault.isUnlocked('claude')).toBe(false);

    await vault.unlock('claude', 'a secure passphrase');
    await expect(vault.withApiKey('claude', async (key) => key)).resolves.toBe(
      'secret-api-key',
    );
  });

  it('supports passphrase rotation and API-key replacement without plaintext storage', async () => {
    const repository = new MemoryRepository();
    const vault = new CredentialVault(repository);
    await vault.save('claude', 'first-key', 'first secure passphrase');
    const oldSalt = (await repository.get('claude'))?.salt;

    await vault.changePassphrase('claude', 'second secure passphrase');
    const rotated = await repository.get('claude');
    expect(rotated?.salt).not.toBe(oldSalt);
    expect(JSON.stringify(rotated)).not.toContain('first-key');

    vault.lock('claude');
    await expect(vault.unlock('claude', 'first secure passphrase')).rejects.toThrow(
      'Could not unlock this key.',
    );
    await vault.unlock('claude', 'second secure passphrase');
    await vault.replaceApiKey('claude', 'replacement-key');
    await expect(vault.withApiKey('claude', async (key) => key)).resolves.toBe(
      'replacement-key',
    );
  });

  it('binds ciphertext to its provider, rejects invalid passphrases, and removes keys', async () => {
    const repository = new MemoryRepository();
    const vault = new CredentialVault(repository);
    await expect(vault.save('claude', 'key', ' short ')).rejects.toThrow(
      `Use a passphrase with at least ${MIN_PASSPHRASE_LENGTH} non-space characters.`,
    );
    await vault.save('claude', 'provider-bound-key', 'long enough passphrase');

    const record = await repository.get('claude');
    if (!record) {
      throw new Error('Expected the encrypted record to exist.');
    }
    await repository.save({ ...record, id: 'copilot' });
    await expect(vault.unlock('copilot', 'long enough passphrase')).rejects.toThrow(
      'Could not unlock this key.',
    );
    await vault.remove('claude');
    expect(await vault.hasCredential('claude')).toBe(false);
  });
});
