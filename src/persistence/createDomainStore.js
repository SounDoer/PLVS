// src/persistence/createDomainStore.js
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

  function read() {
    const raw = backend.get(name);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const version = typeof raw.version === "number" ? raw.version : 0;
    return migrate ? migrate(raw, version) : raw;
  }
  function notify() {
    if (!notifySameContext) return;
    listeners.forEach((fn) => fn());
  }
  return {
    read,
    patch(partial) {
      backend.set(name, { ...read(), ...partial });
      notify();
    },
    async persist(partial) {
      backend.set(name, { ...read(), ...partial });
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
      backend.remove(name);
      notify();
    },
    export() {
      return read();
    },
  };
}
