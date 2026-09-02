// src/persistence/pluginStoreBackend.js
/**
 * Production backend: the single source of truth is plvs-settings.json (plugin-store).
 *
 * createDomainStore is synchronous, but the plugin-store JS API is async, so this backend
 * holds a synchronous in-memory cache seeded from window.__PLVS_INITIAL_STATE__ (injected
 * by Rust before first paint) and persists writes asynchronously, fire-and-forget. Reads
 * never hit disk; first paint is flash-free because the seed is already present.
 *
 * `save()` rewrites the entire settings file, so a high-frequency caller (e.g. a drag
 * gesture calling `set()` on every pointermove) would otherwise trigger one full-file
 * write per event. Writes are coalesced instead: `set`/`remove` only mark a key dirty
 * and schedule a trailing flush; the flush a few pointermoves later collapses all of
 * them into one `s.set()` per dirty key plus a single `s.save()`.
 */
const STORE_FILE = "plvs-settings.json";
const FLUSH_DELAY_MS = 200;

let writeEpoch = 0;
let persistenceSuspended = false;
const forceFlushers = new Set();

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
  const dirty = new Map(); // key -> "set" | "delete"
  let flushTimer = null;
  let activeDrain = null;
  let unreportedFailure = null;

  async function drainBatches() {
    while (!persistenceSuspended && dirty.size > 0) {
      const epoch = writeEpoch;
      const ops = new Map(dirty);
      dirty.clear();
      try {
        const s = await store();
        if (epoch !== writeEpoch || persistenceSuspended) return;
        for (const [key, op] of ops) {
          if (op === "delete") await s.delete(key);
          else await s.set(key, cache.get(key));
        }
        await s.save();
      } catch (error) {
        // Background persistence stays fire-and-forget. Keep the original failure so the next
        // explicit flush can report that durable completion was not achieved.
        unreportedFailure ??= error;
      }
    }
  }

  function ensureDrain() {
    if (persistenceSuspended || dirty.size === 0) return activeDrain;
    if (activeDrain) return activeDrain;

    const drain = drainBatches().catch((error) => {
      unreportedFailure ??= error;
    });
    activeDrain = drain;
    drain.then(() => {
      if (activeDrain !== drain) return;
      activeDrain = null;
      if (!persistenceSuspended && dirty.size > 0) ensureDrain();
    });
    return drain;
  }

  function runBatch() {
    flushTimer = null;
    ensureDrain();
  }

  function scheduleBatch() {
    if (!flushTimer) flushTimer = setTimeout(runBatch, FLUSH_DELAY_MS);
  }

  async function forceFlush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    ensureDrain();
    while (activeDrain) await activeDrain;

    if (unreportedFailure) {
      const failure = unreportedFailure;
      unreportedFailure = null;
      throw failure;
    }
  }

  const backend = {
    get(key) {
      const v = cache.get(key);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    },
    set(key, value) {
      cache.set(key, value);
      dirty.set(key, "set");
      scheduleBatch();
    },
    remove(key) {
      cache.delete(key);
      dirty.set(key, "delete");
      scheduleBatch();
    },
    async flush() {
      await forceFlush();
    },
    subscribe() {
      // Single-window app; the file is only written by this process. No cross-context events.
      return () => {};
    },
  };
  forceFlushers.add(forceFlush);
  return backend;
}

export async function flushPluginStorePersistence() {
  await Promise.all([...forceFlushers].map((forceFlush) => forceFlush()));
}
