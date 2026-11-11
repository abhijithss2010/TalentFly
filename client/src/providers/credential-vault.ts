import type { EntityRepository } from '../data/local-data-service';
import type { EncryptedCredentialRecord, ProviderId } from '../data/models';

export const CREDENTIAL_FORMAT = 'talentfly-credential-v1';
export const CREDENTIAL_KDF_ITERATIONS = 310_000;
export const MIN_PASSPHRASE_LENGTH = 12;

const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Stored credential data is damaged. Remove the key and add it again.');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function associatedData(providerId: ProviderId): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(`${CREDENTIAL_FORMAT}:${providerId}`);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
}

function validatePassphrase(passphrase: string): void {
  if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Use a passphrase with at least ${MIN_PASSPHRASE_LENGTH} non-space characters.`);
  }
}

function validateEnvelope(record: EncryptedCredentialRecord): void {
  if (
    record.format !== CREDENTIAL_FORMAT ||
    !Number.isInteger(record.iterations) ||
    record.iterations < 100_000 ||
    record.iterations > 2_000_000 ||
    base64ToBytes(record.salt).length !== SALT_LENGTH ||
    base64ToBytes(record.iv).length !== IV_LENGTH ||
    base64ToBytes(record.ciphertext).length < 16
  ) {
    throw new Error('Stored credential data is damaged. Remove the key and add it again.');
  }
}

export class CredentialVault {
  private readonly unlockedKeys = new Map<ProviderId, CryptoKey>();

  constructor(
    private readonly repository: EntityRepository<EncryptedCredentialRecord>,
    private readonly cryptoProvider: Crypto = globalThis.crypto,
    private readonly iterations = CREDENTIAL_KDF_ITERATIONS,
  ) {
    if (!cryptoProvider?.subtle || !cryptoProvider.getRandomValues) {
      throw new Error('Secure browser cryptography is not available in this browser.');
    }
  }

  async hasCredential(providerId: ProviderId): Promise<boolean> {
    return Boolean(await this.repository.get(providerId));
  }

  isUnlocked(providerId: ProviderId): boolean {
    return this.unlockedKeys.has(providerId);
  }

  async save(providerId: ProviderId, apiKey: string, passphrase: string): Promise<void> {
    validatePassphrase(passphrase);
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      throw new Error('Enter an API key before saving.');
    }
    if (!Number.isInteger(this.iterations) || this.iterations < 100_000) {
      throw new Error('The credential encryption work factor is invalid.');
    }

    const salt = this.cryptoProvider.getRandomValues(
      new Uint8Array(new ArrayBuffer(SALT_LENGTH)),
    );
    const key = await this.deriveKey(passphrase, salt, this.iterations);
    await this.encryptAndSave(providerId, normalizedKey, salt, key, this.iterations);
  }

  async replaceApiKey(providerId: ProviderId, apiKey: string): Promise<void> {
    const key = this.unlockedKeys.get(providerId);
    if (!key) {
      throw new Error('Unlock this provider before replacing its API key.');
    }
    const record = await this.repository.get(providerId);
    if (!record) {
      throw new Error('No saved API key exists for this provider.');
    }
    validateEnvelope(record);
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      throw new Error('Enter an API key before saving.');
    }
    await this.encryptAndSave(
      providerId,
      normalizedKey,
      base64ToBytes(record.salt),
      key,
      record.iterations,
      record.createdAt,
    );
  }

  async unlock(providerId: ProviderId, passphrase: string): Promise<void> {
    const record = await this.repository.get(providerId);
    if (!record) {
      throw new Error('No saved API key exists for this provider.');
    }
    validateEnvelope(record);
    const key = await this.deriveKey(passphrase, base64ToBytes(record.salt), record.iterations);
    const plaintext = await this.decrypt(record, key);
    plaintext.fill(0);
    this.unlockedKeys.set(providerId, key);
  }

  lock(providerId?: ProviderId): void {
    if (providerId) {
      this.unlockedKeys.delete(providerId);
    } else {
      this.unlockedKeys.clear();
    }
  }

  async withApiKey<T>(
    providerId: ProviderId,
    operation: (apiKey: string) => Promise<T>,
  ): Promise<T> {
    const key = this.unlockedKeys.get(providerId);
    if (!key) {
      throw new Error('Unlock this provider before using its API key.');
    }

    const record = await this.repository.get(providerId);
    if (!record) {
      this.lock(providerId);
      throw new Error('The saved API key was removed. Add it again in Provider settings.');
    }
    validateEnvelope(record);

    const plaintext = await this.decrypt(record, key);
    try {
      const apiKey = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      if (!apiKey) {
        throw new Error('The saved API key is empty. Add it again in Provider settings.');
      }
      return await operation(apiKey);
    } finally {
      plaintext.fill(0);
    }
  }

  async changePassphrase(providerId: ProviderId, newPassphrase: string): Promise<void> {
    validatePassphrase(newPassphrase);
    await this.withApiKey(providerId, (apiKey) =>
      this.save(providerId, apiKey, newPassphrase),
    );
  }

  async remove(providerId: ProviderId): Promise<void> {
    this.lock(providerId);
    await this.repository.delete(providerId);
  }

  private async encryptAndSave(
    providerId: ProviderId,
    apiKey: string,
    salt: Uint8Array<ArrayBuffer>,
    key: CryptoKey,
    iterations: number,
    createdAt?: string,
  ): Promise<void> {
    const iv = this.cryptoProvider.getRandomValues(
      new Uint8Array(new ArrayBuffer(IV_LENGTH)),
    );
    const plaintext = new TextEncoder().encode(apiKey);
    let encrypted: ArrayBuffer;
    try {
      encrypted = await this.cryptoProvider.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: associatedData(providerId),
          tagLength: 128,
        },
        key,
        plaintext,
      );
    } finally {
      plaintext.fill(0);
    }

    const now = new Date().toISOString();
    const existing = await this.repository.get(providerId);
    await this.repository.save({
      id: providerId,
      format: CREDENTIAL_FORMAT,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      iterations,
      createdAt: createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.unlockedKeys.set(providerId, key);
  }

  private async deriveKey(
    passphrase: string,
    salt: Uint8Array<ArrayBuffer>,
    iterations: number,
  ): Promise<CryptoKey> {
    validatePassphrase(passphrase);
    const passphraseBytes = new TextEncoder().encode(passphrase);
    try {
      const material = await this.cryptoProvider.subtle.importKey(
        'raw',
        passphraseBytes,
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      return await this.cryptoProvider.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } finally {
      passphraseBytes.fill(0);
    }
  }

  private async decrypt(
    record: EncryptedCredentialRecord,
    key: CryptoKey,
  ): Promise<Uint8Array> {
    try {
      const plaintext = await this.cryptoProvider.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToBytes(record.iv),
          additionalData: associatedData(record.id),
          tagLength: 128,
        },
        key,
        base64ToBytes(record.ciphertext),
      );
      return new Uint8Array(plaintext);
    } catch {
      throw new Error('Could not unlock this key. Check your passphrase or remove and re-add the key.');
    }
  }
}
