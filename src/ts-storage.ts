// Synchronous get/set storage adapter for tailscale-web, backed by IndexedDB (workers have no localStorage).
// All keys are preloaded into memory at boot; writes are write-through (async, fire-and-forget).
const DB = "phone-agent";
const STORE = "ts-state";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SyncStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  keys(): string[];
  clear(): Promise<void>;
}

export async function openTsStorage(): Promise<SyncStorage> {
  const db = await openDb();
  const cache = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { cache.set(String(c.key), String(c.value)); c.continue(); } else resolve();
    };
    req.onerror = () => reject(req.error);
  });
  return {
    get: (k) => cache.get(k) ?? null,
    set: (k, v) => {
      cache.set(k, v);
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(v, k);
      tx.onerror = () => console.error("ts-storage write failed", tx.error);
    },
    keys: () => [...cache.keys()],
    clear: () => new Promise((resolve, reject) => {
      cache.clear();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
  };
}
