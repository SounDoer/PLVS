// src/persistence/pluginStoreBackend.js
/**
 * Production backend: the single source of truth is plvs-settings.json (plugin-store).
 *
 * createDomainStore is synchronous, but the plugin-store JS API is async, so this backend
 * holds a synchronous in-memory cache seeded from window.__PLVS_INITIAL_STATE__ (injected
 * by Rust before first paint) and persists writes asynchronously, fire-and-forget. Reads
 * never hit disk; first paint is flash-free because the seed is already present.
 */
const STORE_FILE = "plvs-settings.json";

let writeEpoch = 0;
let persistenceSuspended = false;
const pendingWrites = new Set();

export function suspendPluginStorePersistence() {
  persistenceSuspended = true;
  writeEpoch += 1;
}

export function createPluginStoreBackend() {
  const seed = (typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__) || {};
  const cache = new Map(Object.entries(seed));

  let storePromise = null;
  function store() {
    if (!storePromise) {
      storePromise = import("@tauri-apps/plugin-store").then(({ Store }) => Store.load(STORE_FILE));
    }
    return storePromise;
  }
  const pending = new Map();
  function trackPending(key, p) {
    pending.set(key, p);
    pendingWrites.add(p);
    p.finally(() => pendingWrites.delete(p));
    return p;
  }
  function persist(key, value) {
    if (persistenceSuspended) return Promise.resolve();
    const epoch = writeEpoch;
    const p = store()
      .then(async (s) => {
        if (epoch !== writeEpoch || persistenceSuspended) return;
        await s.set(key, value);
        await s.save();
      })
      .catch(() => {});
    return trackPending(key, p);
  }
  function persistDelete(key) {
    if (persistenceSuspended) return Promise.resolve();
    const epoch = writeEpoch;
    const p = store()
      .then(async (s) => {
        if (epoch !== writeEpoch || persistenceSuspended) return;
        await s.delete(key);
        await s.save();
      })
      .catch(() => {});
    return trackPending(key, p);
  }

  return {
    get(key) {
      const v = cache.get(key);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    },
    set(key, value) {
      cache.set(key, value);
      persist(key, value);
    },
    remove(key) {
      cache.delete(key);
      persistDelete(key);
    },
    async flush(key) {
      await pending.get(key);
    },
    subscribe() {
      // Single-window app; the file is only written by this process. No cross-context events.
      return () => {};
    },
  };
}

export async function flushPluginStorePersistence() {
  await Promise.allSettled([...pendingWrites]);
}
