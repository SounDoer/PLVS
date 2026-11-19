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
 *     flush?: (name: string) => Promise<void> | void,
 *   },
 *   migrate?: (raw: object, version: number) => object,
 *   writeVersion?: number,
 *   notifySameContext?: boolean,
 * }} opts
 */
export function createDomainStore({
  name,
  backend,
  migrate,
  writeVersion,
  notifySameContext = false,
}) {
  const listeners = new Set();
  // Values accepted by `patchCoalesced` that have not reached the backend yet. They take part in
  // writes only. `read` deliberately does NOT merge them: doing so lets this context's in-flight
  // values shadow a write that arrived from outside it -- another window, or a boot that seeds
  // storage directly -- which is exactly the state a reader is trying to observe.
  let pending = null;
  /** @type {ReturnType<typeof setTimeout> | 0} */
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
  /**
   * Writes stored state with any pending values, then `partial`, applied on top in that order.
   * @param {string} [fieldToRemove]
   */
  function writeMerged(partial, fieldToRemove) {
    const next = {
      ...read(),
      ...pending,
      ...partial,
      ...(Number.isFinite(writeVersion) ? { version: writeVersion } : null),
    };
    if (fieldToRemove !== undefined) delete next[fieldToRemove];
    backend.set(name, next);
    cancelPending();
  }
  function flush() {
    if (!pending) return;
    writeMerged({});
    // Subscribers are told when the value actually lands, never before, so a same-context
    // listener that calls `read` always sees what it was notified about.
    notify();
  }
  // Desktop shutdown flushes explicitly before closing. On pagehide, move any remaining
  // coalesced changes to the backend, including synchronous localStorage writes in the browser.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", flush);
  }
  return {
    read,
    flush,
    /**
     * Announce a write to this context's subscribers, whatever `notifySameContext` says.
     *
     * Call this when a local writer changes data owned by another React surface. The transactional
     * backend notifies subscribers when it reconciles remote changes. Local writes to a domain
     * with same-context notifications disabled rely on the owning writer to update React state.
     *
     * Deliberately not `notifySameContext: true` on the store instead: `plvs:settings` is written
     * through `patchCoalesced` during an opacity drag, and every subscriber re-reading four times
     * a second is a cost the ordinary path should not pay for the sake of an occasional import.
     */
    notifyLocal() {
      listeners.forEach((fn) => fn());
    },
    patch(partial) {
      writeMerged(partial);
      notify();
    },
    /** Remove one field while committing any other pending edits to this domain. */
    unset(field) {
      writeMerged({}, field);
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
