import {
  LOCAL_DATABASE_NAME,
  LOCAL_STORE_NAMES,
  USER_DATA_STORE_NAMES,
  openLocalDatabase,
  type LocalStoreName,
} from './database';
import type {
  AppSettingsRecord,
  ComparisonRunRecord,
  EncryptedCredentialRecord,
  ExportedResumeRecord,
  JobRecord,
  LocalDataExport,
  ResumeRecord,
  StoredRecord,
  UsageRecord,
} from './models';

export interface EntityRepository<T extends StoredRecord> {
  get(id: string): Promise<T | undefined>;
  getAll(): Promise<T[]>;
  save(record: T): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LocalDataServices {
  resumes: EntityRepository<ResumeRecord>;
  jobs: EntityRepository<JobRecord>;
  runs: EntityRepository<ComparisonRunRecord>;
  usage: EntityRepository<UsageRecord>;
  settings: EntityRepository<AppSettingsRecord>;
  credentials: EntityRepository<EncryptedCredentialRecord>;
  exportData(): Promise<LocalDataExport>;
  importData(data: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  close(): void;
}

interface ValidatedLocalData extends Omit<LocalDataExport, 'data'> {
  data: Omit<LocalDataExport['data'], 'resumes'> & {
    resumes: ResumeRecord[];
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('The local data request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('The local data transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The local data transaction was aborted.'));
  });
}

async function withStore<T>(
  database: IDBDatabase,
  storeName: LocalStoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = database.transaction(storeName, mode);
  const completed = transactionComplete(transaction);

  try {
    const result = await requestResult(operation(transaction.objectStore(storeName)));
    await completed;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    await completed.catch(() => undefined);
    throw error;
  }
}

function createRepository<T extends StoredRecord>(
  database: IDBDatabase,
  storeName: LocalStoreName,
): EntityRepository<T> {
  return {
    get: (id) => withStore<T | undefined>(database, storeName, 'readonly', (store) => store.get(id)),
    getAll: () => withStore<T[]>(database, storeName, 'readonly', (store) => store.getAll()),
    save: async (record) => {
      await withStore(database, storeName, 'readwrite', (store) => store.put(record));
    },
    delete: async (id) => {
      await withStore(database, storeName, 'readwrite', (store) => store.delete(id));
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidIdentity(value: unknown): value is Record<string, unknown> & StoredRecord {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
  );
}

function validateRecords<T extends StoredRecord>(
  value: unknown,
  validate: (record: Record<string, unknown>) => boolean,
  label: string,
): T[] {
  if (!Array.isArray(value) || !value.every(hasValidIdentity)) {
    throw new Error(`The imported ${label} data is invalid.`);
  }

  const records = value;
  if (!records.every((record) => hasValidIdentity(record) && validate(record))) {
    throw new Error(`The imported ${label} data is invalid.`);
  }

  const ids = new Set(
    records.map((record) => (isObject(record) ? record.id : undefined)),
  );
  if (ids.size !== records.length) {
    throw new Error(`The imported ${label} data contains duplicate IDs.`);
  }

  return records as T[];
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isProviderId(value: unknown): value is NonNullable<AppSettingsRecord['preferredProvider']> {
  return isText(value) && value.length > 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(value: string, mimeType: string): Blob {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('The imported resume file data is invalid.');
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('The imported resume file data is invalid.');
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function validateExport(value: unknown): ValidatedLocalData {
  if (
    !isObject(value) ||
    value.format !== 'talentfly-local-data' ||
    value.version !== 1 ||
    typeof value.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    !isObject(value.data)
  ) {
    throw new Error('The imported local data file has an unsupported format or version.');
  }

  const data = value.data;
  const exportedResumes = validateRecords<ExportedResumeRecord>(
    data.resumes,
    (record) =>
      isText(record.name) &&
      isText(record.fileName) &&
      isText(record.mimeType) &&
      typeof record.fileSize === 'number' &&
      Number.isFinite(record.fileSize) &&
      record.fileSize >= 0 &&
      isText(record.fileBase64) &&
      isText(record.extractedText),
    'resume',
  );
  const resumes: ResumeRecord[] = exportedResumes.map(({ fileBase64, ...record }) => {
    const file = base64ToBlob(fileBase64, record.mimeType);
    if (file.size !== record.fileSize) {
      throw new Error('The imported resume file size does not match its metadata.');
    }
    return { ...record, file };
  });
  const jobs = validateRecords<JobRecord>(
    data.jobs,
    (record) =>
      isText(record.title) &&
      isText(record.description) &&
      (record.company === undefined || isText(record.company)) &&
      (record.location === undefined || isText(record.location)) &&
      (record.sourceUrl === undefined || isText(record.sourceUrl)),
    'job',
  );
  const runs = validateRecords<ComparisonRunRecord>(
    data.runs,
    (record) =>
      isText(record.jobId) &&
      Array.isArray(record.resumeIds) &&
      record.resumeIds.every(isText) &&
      ['received', 'analysing', 'done', 'failed'].includes(String(record.status)) &&
      (record.provider === undefined || isProviderId(record.provider)) &&
      (record.result === undefined || isObject(record.result)) &&
      (record.error === undefined || isText(record.error)),
    'run',
  );
  const usage = validateRecords<UsageRecord>(
    data.usage,
    (record) =>
      isText(record.runId) &&
      isProviderId(record.provider) &&
      ['inputTokens', 'outputTokens', 'estimatedCostUsd'].every(
        (key) => record[key] === undefined ||
          (typeof record[key] === 'number' && Number.isFinite(record[key])),
      ),
    'usage',
  );
  const settings = validateRecords<AppSettingsRecord>(
    data.settings,
    (record) =>
      record.id === 'app' &&
      (record.defaultResumeId === null || isText(record.defaultResumeId)) &&
      (record.preferredProvider === null || isProviderId(record.preferredProvider)) &&
      (record.providerModels === undefined ||
        (isObject(record.providerModels) &&
          Object.values(record.providerModels).every(isText))),
    'settings',
  );

  return {
    format: 'talentfly-local-data',
    version: 1,
    exportedAt: value.exportedAt,
    data: { resumes, jobs, runs, usage, settings },
  };
}

function readAll<T>(store: IDBObjectStore): IDBRequest<T[]> {
  return store.getAll();
}

function addAll<T extends StoredRecord>(store: IDBObjectStore, records: T[]): void {
  for (const record of records) {
    store.put(record);
  }
}

export function createRecordId(prefix: string): string {
  if (!/^[a-z][a-z0-9-]*$/i.test(prefix)) {
    throw new Error('Record ID prefixes may contain only letters, numbers, and hyphens.');
  }

  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure random ID generation is not available in this browser.');
  }

  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export async function createLocalDataServices(options?: {
  databaseName?: string;
  indexedDB?: IDBFactory;
}): Promise<LocalDataServices> {
  const database = await openLocalDatabase(
    options?.databaseName ?? LOCAL_DATABASE_NAME,
    options?.indexedDB,
  );

  return {
    resumes: createRepository(database, 'resumes'),
    jobs: createRepository(database, 'jobs'),
    runs: createRepository(database, 'runs'),
    usage: createRepository(database, 'usage'),
    settings: createRepository(database, 'settings'),
    credentials: createRepository(database, 'credentials'),
    async exportData() {
      const transaction = database.transaction(USER_DATA_STORE_NAMES, 'readonly');
      const completed = transactionComplete(transaction);
      const resumes = requestResult<ResumeRecord[]>(readAll(transaction.objectStore('resumes')));
      const jobs = requestResult<JobRecord[]>(readAll(transaction.objectStore('jobs')));
      const runs = requestResult<ComparisonRunRecord[]>(readAll(transaction.objectStore('runs')));
      const usage = requestResult<UsageRecord[]>(readAll(transaction.objectStore('usage')));
      const settings = requestResult<AppSettingsRecord[]>(readAll(transaction.objectStore('settings')));
      const [resumeRecords, jobRecords, runRecords, usageRecords, settingRecords] =
        await Promise.all([resumes, jobs, runs, usage, settings]);
      await completed;
      const exportedResumes = await Promise.all(
        resumeRecords.map(async ({ file, ...record }) => {
          if (file.size !== record.fileSize) {
            throw new Error(`Resume "${record.id}" has inconsistent file size metadata.`);
          }

          return {
            ...record,
            fileBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
          };
        }),
      );
      return {
        format: 'talentfly-local-data',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          resumes: exportedResumes,
          jobs: jobRecords,
          runs: runRecords,
          usage: usageRecords,
          settings: settingRecords,
        },
      };
    },
    async importData(untrustedData: unknown) {
      const data = validateExport(untrustedData);
      const transaction = database.transaction(USER_DATA_STORE_NAMES, 'readwrite');
      const completed = transactionComplete(transaction);

      try {
        for (const name of USER_DATA_STORE_NAMES) {
          transaction.objectStore(name).clear();
        }
        addAll(transaction.objectStore('resumes'), data.data.resumes);
        addAll(transaction.objectStore('jobs'), data.data.jobs);
        addAll(transaction.objectStore('runs'), data.data.runs);
        addAll(transaction.objectStore('usage'), data.data.usage);
        addAll(transaction.objectStore('settings'), data.data.settings);
        await completed;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
        await completed.catch(() => undefined);
        throw error;
      }
    },
    async deleteAll() {
      const transaction = database.transaction(LOCAL_STORE_NAMES, 'readwrite');
      const completed = transactionComplete(transaction);
      try {
        for (const name of LOCAL_STORE_NAMES) {
          transaction.objectStore(name).clear();
        }
        await completed;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
        await completed.catch(() => undefined);
        throw error;
      }
    },
    close: () => database.close(),
  };
}
