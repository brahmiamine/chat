/** IndexedDB persistence for conversations (one record per conversation). */
import type { Conversation } from '../types';

const DB_NAME = 'lueur';
const STORE = 'conversations';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const conversationDb = {
  async all(): Promise<Conversation[]> {
    return ((await tx<Conversation[]>('readonly', s => s.getAll())) || []);
  },
  put(c: Conversation) {
    return tx('readwrite', s => s.put(c));
  },
  remove(id: string) {
    return tx('readwrite', s => s.delete(id));
  },
  clear() {
    return tx('readwrite', s => s.clear());
  },
};
