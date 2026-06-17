// src/persistence/localStorageBackend.js
/**
 * localStorage implementation of the persistence backend contract.
 * Synchronous; deals in plain objects (JSON is an internal detail).
 *
 * Contract:
 *   get(key)            -> object | null   (null when absent/corrupt/non-object)
 *   set(key, value)     -> void
 *   remove(key)         -> void
 *   subscribe(key, fn)  -> () => void      (fires on cross-context change of key)
 */
export function createLocalStorageBackend() {
  return {
    get(key) {
      if (typeof localStorage === "undefined") return null;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        return null;
      } catch (_) {
        return null;
      }
    },
    set(key, value) {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {}
    },
    remove(key) {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    },
    subscribe(key, fn) {
      if (typeof window === "undefined") return () => {};
      const onStorage = (e) => {
        // e.key === null is a localStorage.clear(); treat as relevant.
        if (e.key !== key && e.key !== null) return;
        fn();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}
