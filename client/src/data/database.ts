export const LOCAL_DATABASE_NAME = 'talentfly-local';
export const LOCAL_DATABASE_VERSION = 2;

export const LOCAL_STORE_NAMES = [
  'resumes',
  'jobs',
  'runs',
  'usage',
  'settings',
] as const;

export type LocalStoreName = (typeof LOCAL_STORE_NAMES)[number];

type Migration = (database: IDBDatabase, transaction: IDBTransaction) => void;

function ensureStore(
  database: IDBDatabase,
  transaction: IDBTransaction,
  name: LocalStoreName,
): IDBObjectStore {
  if (database.objectStoreNames.contains(name)) {
    return transaction.objectStore(name);
  }

  return database.createObjectStore(name, { keyPath: 'id' });
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
  options?: IDBIndexParameters,
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

const migrations: Record<number, Migration> = {
  1(database, transaction) {
    for (const name of ['resumes', 'jobs', 'runs'] as const) {
      const store = ensureStore(database, transaction, name);
      ensureIndex(store, 'byCreatedAt', 'createdAt');
    }
  },
  2(database, transaction) {
    for (const name of ['usage', 'settings'] as const) {
      ensureStore(database, transaction, name);
    }

    for (const name of ['resumes', 'jobs', 'runs', 'usage', 'settings'] as const) {
      const store = ensureStore(database, transaction, name);
      ensureIndex(store, 'byUpdatedAt', 'updatedAt');
    }

    const runs = transaction.objectStore('runs');
    ensureIndex(runs, 'byStatus', 'status');

    const usage = transaction.objectStore('usage');
    ensureIndex(usage, 'byRunId', 'runId');
    ensureIndex(usage, 'byCreatedAt', 'createdAt');
  },
};

function requestError<T>(request: IDBRequest<T>, message: string): Error {
  return request.error ?? new Error(message);
}

export function openLocalDatabase(
  name = LOCAL_DATABASE_NAME,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(name, LOCAL_DATABASE_VERSION);
    let settled = false;

    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (!transaction) {
        reject(new Error('The local data database upgrade could not be started.'));
        settled = true;
        return;
      }

      try {
        for (let version = event.oldVersion + 1; version <= LOCAL_DATABASE_VERSION; version += 1) {
          const migrate = migrations[version];
          if (!migrate) {
            throw new Error(`The local data database migration ${version} is not available.`);
          }
          migrate(request.result, transaction);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
        settled = true;
      }
    };

    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }

      request.result.onversionchange = () => request.result.close();
      settled = true;
      resolve(request.result);
    };

    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(requestError(request, 'The local data database could not be opened.'));
      }
    };

    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error('The local data database upgrade is blocked by another open tab.'));
      }
    };
  });
}
