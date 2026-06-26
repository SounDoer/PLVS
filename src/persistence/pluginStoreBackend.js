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
  function persist(key, value) {
    const p = store()
      .then(async (s) => {
        await s.set(key, value);
        await s.save();
      })
      .catch(() => {});
    pending.set(key, p);
    return p;
  }
  function persistDelete(key) {
    const p = store()
      .then(async (s) => {
        await s.delete(key);
        await s.save();
      })
      .catch(() => {});
    pending.set(key, p);
    return p;
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
