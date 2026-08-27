// src/persistence/createDomainStore.js
/**
 * Width of a coalescing window. The first coalesced patch opens it and the write lands when it
 * closes, so a sustained drag costs about four writes a second instead of one per pointer move,
 * and nothing is ever delayed by more than this.
 */
const COALESCE_DELAY_MS = 250;

/**
 * Factory for one persistence domain. Owns the mechanics only — safe read,
 * read-merge-write, lazy version resolution, and cross-context subscription.
 * Defaults, validation, and field semantics stay with the consuming modules.
 *
 * Lazy versioning: the version field is read as `raw.version ?? 0` and nothing
 * writes it until a future breaking change introduces a migration (then `save`
 * starts stamping it). See the design spec, "Versioning".
 *
 * @param {{
 *   name: string,
 *   backend: {
 *     get: (key: string) => object | null,
 *     set: (key: string, value: object) => void,
 *     remove: (key: string) => void,
 *     subscribe: (key: string, fn: () => void) => () => void,
 *   },
 *   migrate?: (raw: object, version: number) => object,
 *   notifySameContext?: boolean,
 * }} opts
 */
export function createDomainStore({ name, backend, migrate, notifySameContext = false }) {
  const listeners = new Set();
  // Values accepted by `patchCoalesced` that have not reached the backend yet. They take part in
  // writes only. `read` deliberately does NOT merge them: doing so lets this context's in-flight
  // values shadow a write that arrived from outside it -- another window, or a boot that seeds
  // storage directly -- which is exactly the state a reader is trying to observe.
  let pending = null;
  let flushTimer = 0;

  function read() {
    const raw = backend.get(name);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const version = typeof raw.version === "number" ? raw.version : 0;
    return migrate ? migrate(raw, version) : raw;
  }
  function cancelPending() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = 0;
    }
    pending = null;
  }
  function notify() {
    if (!notifySameContext) return;
    listeners.forEach((fn) => fn());
  }
  /** Writes stored state with any pending values, then `partial`, applied on top in that order. */
  function writeMerged(partial) {
    const next = { ...read(), ...pending, ...partial };
    cancelPending();
    backend.set(name, next);
  }
  function flush() {
    if (!pending) return;
    writeMerged({});
    // Subscribers are told when the value actually lands, never before, so a same-context
    // listener that calls `read` always sees what it was notified about.
    notify();
  }
  // A pending write must not die with the window. Tauri tears the webview down on close, and
  // `pagehide` is the last point where a synchronous localStorage write still lands.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", flush);
  }
  return {
    read,
    flush,
    patch(partial) {
      writeMerged(partial);
      notify();
    },
    /**
     * Same result as `patch`, but collapses a burst into one write. For continuous inputs only
     * -- a slider drag otherwise costs one get + parse + merge + stringify + set per pointer
     * move, on the main thread, and the workspace domain carries the whole layout tree.
     */
    patchCoalesced(partial) {
      pending = pending ? { ...pending, ...partial } : { ...partial };
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = 0;
        flush();
      }, COALESCE_DELAY_MS);
    },
    async persist(partial) {
      writeMerged(partial);
      notify();
      await backend.flush?.(name);
    },
    subscribe(fn) {
      listeners.add(fn);
      const unsubscribeBackend = backend.subscribe(name, fn);
      return () => {
        listeners.delete(fn);
        unsubscribeBackend();
      };
    },
    reset() {
      cancelPending();
      backend.remove(name);
      notify();
    },
    export() {
      flush();
      return read();
    },
  };
}
