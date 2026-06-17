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
 * }} opts
 */
export function createDomainStore({ name, backend, migrate }) {
  function read() {
    const raw = backend.get(name);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const version = typeof raw.version === "number" ? raw.version : 0;
    return migrate ? migrate(raw, version) : raw;
  }
  return {
    read,
    patch(partial) {
      backend.set(name, { ...read(), ...partial });
    },
    subscribe(fn) {
      return backend.subscribe(name, fn);
    },
    reset() {
      backend.remove(name);
    },
    export() {
      return read();
    },
  };
}
