import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_DATABASE_VERSION,
  openLocalDatabase,
} from './database';

const databaseNames: string[] = [];

function uniqueDatabaseName(): string {
  const name = `talentfly-test-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

function openLegacyDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const storeName of ['resumes', 'jobs', 'runs']) {
        const store = database.createObjectStore(storeName, { keyPath: 'id' });
        store.createIndex('byCreatedAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe('local IndexedDB schema', () => {
  it('migrates a version 1 database without losing its records', async () => {
    const name = uniqueDatabaseName();
    const legacy = await openLegacyDatabase(name);
    const oldResume = {
      id: 'resume-existing',
      name: 'Existing resume',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = legacy.transaction('resumes', 'readwrite');
      transaction.objectStore('resumes').put(oldResume);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const upgraded = await openLocalDatabase(name, indexedDB);

    expect(upgraded.version).toBe(LOCAL_DATABASE_VERSION);
    expect([...upgraded.objectStoreNames]).toEqual(
      expect.arrayContaining(['resumes', 'jobs', 'runs', 'usage', 'settings', 'credentials']),
    );
    expect(upgraded.transaction('resumes').objectStore('resumes').indexNames.contains('byUpdatedAt'))
      .toBe(true);

    const storedResume = await new Promise((resolve, reject) => {
      const request = upgraded.transaction('resumes').objectStore('resumes').get(oldResume.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(storedResume).toEqual(oldResume);
    upgraded.close();
  });
});
