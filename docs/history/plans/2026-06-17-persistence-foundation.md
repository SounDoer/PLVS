# Persistence Foundation Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the unified persistence layer (`createDomainStore` + a backend seam + the `settings`/`workspace` domain stores + `exportAll`/`resetAll` + a legacy-key cleanup helper) as new, fully-tested infrastructure, with no consumer changes yet.

**Architecture:** A `backend` adapter abstracts the physical store (`get`/`set`/`remove`/`subscribe` over plain objects). `createDomainStore` owns all mechanics (safe read, read-merge-write, lazy `version` resolution, subscribe) and knows nothing about a domain's fields. `index.js` instantiates two domain stores over a single localStorage backend and exposes top-level `exportAll`/`resetAll`. This plan adds only the localStorage backend; Plan 2 swaps in a plugin-store backend behind the same seam.

**Tech Stack:** JavaScript (ESM), Vitest (jsdom env, globals on), localStorage.

**Spec:** `docs/superpowers/specs/2026-06-17-persistence-unification-design.md`

**Roadmap (this is Plan 1 of 3):**
- **Plan 1 — Persistence foundation (this document):** new `src/persistence/*` module, tested in isolation. Nothing consumes it yet.
- **Plan 2 — Consumer migration + persisted-set trim:** point `useSettings`, `App.jsx`, `themeResolve`, `panelControls`, `WorkspaceContext`, `useAlwaysOnTop`, `useCloseConfirm` at the domain stores; retire `plvs.ui`; remove `focusId` from the state model; drop the vestigial drag-ratio code; make `fullscreenId` runtime-only; wire `cleanupLegacyKeys` on boot.
- **Plan 3 — plugin-store backend + Rust first-paint injection + window geometry:** flip production to `plvs-settings.json`, add `window.__PLVS_INITIAL_STATE__`, persist/restore window bounds with off-screen clamping.

---

## File Structure (Plan 1)

- Create `src/persistence/localStorageBackend.js` — localStorage implementation of the backend contract (objects in/out; JSON handled internally).
- Create `src/persistence/localStorageBackend.test.js`
- Create `src/persistence/createDomainStore.js` — the domain-store factory (mechanics only).
- Create `src/persistence/createDomainStore.test.js`
- Create `src/persistence/index.js` — `settingsStore`, `workspaceStore`, `exportAll`, `resetAll`.
- Create `src/persistence/index.test.js`
- Create `src/persistence/cleanupLegacyKeys.js` — one-shot idempotent removal of pre-unification localStorage keys.
- Create `src/persistence/cleanupLegacyKeys.test.js`

**Backend contract** (used by `createDomainStore`, satisfied by every backend):
- `get(key) -> object | null` — the stored object, or `null` when absent/corrupt.
- `set(key, value) -> void` — persist a plain object.
- `remove(key) -> void`.
- `subscribe(key, fn) -> () => void` — call `fn` on cross-context change of `key`; returns an unsubscribe.

---

## Task 1: localStorage backend

**Files:**
- Create: `src/persistence/localStorageBackend.js`
- Test: `src/persistence/localStorageBackend.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/persistence/localStorageBackend.test.js
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageBackend } from "./localStorageBackend.js";

describe("localStorageBackend", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when the key is absent", () => {
    const backend = createLocalStorageBackend();
    expect(backend.get("plvs:settings")).toBeNull();
  });

  it("round-trips a plain object through set/get", () => {
    const backend = createLocalStorageBackend();
    backend.set("plvs:settings", { referenceLufs: -23 });
    expect(backend.get("plvs:settings")).toEqual({ referenceLufs: -23 });
  });

  it("returns null for corrupt JSON", () => {
    const backend = createLocalStorageBackend();
    localStorage.setItem("plvs:settings", "{not json");
    expect(backend.get("plvs:settings")).toBeNull();
  });

  it("returns null when the stored value is not a plain object (array)", () => {
    const backend = createLocalStorageBackend();
    localStorage.setItem("plvs:settings", JSON.stringify([1, 2, 3]));
    expect(backend.get("plvs:settings")).toBeNull();
  });

  it("remove deletes the key", () => {
    const backend = createLocalStorageBackend();
    backend.set("plvs:settings", { a: 1 });
    backend.remove("plvs:settings");
    expect(backend.get("plvs:settings")).toBeNull();
  });

  it("subscribe fires fn on a matching storage event and unsubscribes", () => {
    const backend = createLocalStorageBackend();
    const fn = vi.fn();
    const off = backend.subscribe("plvs:settings", fn);

    window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" }));
    expect(fn).toHaveBeenCalledTimes(1);

    // null key means localStorage.clear(); treat as relevant
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(fn).toHaveBeenCalledTimes(2);

    // unrelated key is ignored
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(fn).toHaveBeenCalledTimes(2);

    off();
    window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" }));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/localStorageBackend.test.js`
Expected: FAIL — cannot resolve `./localStorageBackend.js`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/persistence/localStorageBackend.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/localStorageBackend.js src/persistence/localStorageBackend.test.js
git commit -m "feat(persistence): add localStorage backend"
```

---

## Task 2: createDomainStore factory

**Files:**
- Create: `src/persistence/createDomainStore.js`
- Test: `src/persistence/createDomainStore.test.js`

The factory owns mechanics only. `read()` resolves the lazy version (`raw.version ?? 0`) and runs an optional `migrate(raw, version)` hook (none supplied yet). `patch()` is read-merge-write so disjoint writers cannot clobber each other.

- [ ] **Step 1: Write the failing test**

```js
// src/persistence/createDomainStore.test.js
import { describe, expect, it, vi } from "vitest";
import { createDomainStore } from "./createDomainStore.js";

/** In-memory backend stub satisfying the contract. */
function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  const subs = new Map();
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => {
      map.set(key, value);
      (subs.get(key) || []).forEach((fn) => fn());
    },
    remove: (key) => map.delete(key),
    subscribe: (key, fn) => {
      const list = subs.get(key) || [];
      list.push(fn);
      subs.set(key, list);
      return () => subs.set(key, (subs.get(key) || []).filter((f) => f !== fn));
    },
  };
}

describe("createDomainStore", () => {
  it("read returns {} when the backend has nothing", () => {
    const store = createDomainStore({ name: "plvs:settings", backend: memoryBackend() });
    expect(store.read()).toEqual({});
  });

  it("read returns the stored object", () => {
    const backend = memoryBackend({ "plvs:settings": { referenceLufs: -18 } });
    const store = createDomainStore({ name: "plvs:settings", backend });
    expect(store.read()).toEqual({ referenceLufs: -18 });
  });

  it("patch merges over existing fields without clobbering siblings", () => {
    const backend = memoryBackend({ "plvs:settings": { appearance: "fixed", themeId: "x" } });
    const store = createDomainStore({ name: "plvs:settings", backend });
    store.patch({ referenceLufs: -23 });
    expect(store.read()).toEqual({ appearance: "fixed", themeId: "x", referenceLufs: -23 });
  });

  it("does not write a version field on patch (lazy versioning)", () => {
    const backend = memoryBackend();
    const store = createDomainStore({ name: "plvs:settings", backend });
    store.patch({ referenceLufs: -23 });
    expect(store.read()).not.toHaveProperty("version");
  });

  it("calls migrate with (raw, version) using version ?? 0", () => {
    const backend = memoryBackend({ "plvs:settings": { a: 1 } });
    const migrate = vi.fn((raw) => raw);
    const store = createDomainStore({ name: "plvs:settings", backend, migrate });
    store.read();
    expect(migrate).toHaveBeenCalledWith({ a: 1 }, 0);
  });

  it("migrate receives the explicit version when present", () => {
    const backend = memoryBackend({ "plvs:settings": { version: 2, a: 1 } });
    const migrate = vi.fn((raw) => raw);
    const store = createDomainStore({ name: "plvs:settings", backend, migrate });
    store.read();
    expect(migrate).toHaveBeenCalledWith({ version: 2, a: 1 }, 2);
  });

  it("reset removes the domain", () => {
    const backend = memoryBackend({ "plvs:settings": { a: 1 } });
    const store = createDomainStore({ name: "plvs:settings", backend });
    store.reset();
    expect(store.read()).toEqual({});
  });

  it("export equals read", () => {
    const backend = memoryBackend({ "plvs:settings": { a: 1 } });
    const store = createDomainStore({ name: "plvs:settings", backend });
    expect(store.export()).toEqual(store.read());
  });

  it("subscribe is notified on patch and can unsubscribe", () => {
    const backend = memoryBackend();
    const store = createDomainStore({ name: "plvs:settings", backend });
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.patch({ a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    store.patch({ b: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/createDomainStore.test.js`
Expected: FAIL — cannot resolve `./createDomainStore.js`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/persistence/createDomainStore.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/createDomainStore.js src/persistence/createDomainStore.test.js
git commit -m "feat(persistence): add createDomainStore factory"
```

---

## Task 3: Domain stores + exportAll/resetAll

**Files:**
- Create: `src/persistence/index.js`
- Test: `src/persistence/index.test.js`

Instantiates the two domains over one localStorage backend, and exposes the manager-level `exportAll`/`resetAll`. Keys are stable, no `vN` suffix.

- [ ] **Step 1: Write the failing test**

```js
// src/persistence/index.test.js
import { afterEach, describe, expect, it } from "vitest";
import { settingsStore, workspaceStore, exportAll, resetAll } from "./index.js";

describe("persistence index", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("settingsStore persists under plvs:settings", () => {
    settingsStore.patch({ referenceLufs: -23 });
    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toEqual({ referenceLufs: -23 });
  });

  it("workspaceStore persists under plvs:workspace", () => {
    workspaceStore.patch({ activePresetId: "lls" });
    expect(JSON.parse(localStorage.getItem("plvs:workspace"))).toEqual({ activePresetId: "lls" });
  });

  it("exportAll returns both domains keyed by name", () => {
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ activePresetId: "lls" });
    expect(exportAll()).toEqual({
      settings: { referenceLufs: -23 },
      workspace: { activePresetId: "lls" },
    });
  });

  it("resetAll clears both domains", () => {
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ activePresetId: "lls" });
    resetAll();
    expect(localStorage.getItem("plvs:settings")).toBeNull();
    expect(localStorage.getItem("plvs:workspace")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/index.test.js`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/persistence/index.js
/**
 * The single persistence "manager" entry point: two stable, versionless domains
 * over one backend, plus manager-level export/reset.
 *
 * Backend is localStorage today (dev + production). Plan 3 swaps in a
 * plugin-store backend for production behind this same seam — consumers and the
 * domain stores do not change.
 */
import { createLocalStorageBackend } from "./localStorageBackend.js";
import { createDomainStore } from "./createDomainStore.js";

const backend = createLocalStorageBackend();

export const settingsStore = createDomainStore({ name: "plvs:settings", backend });
export const workspaceStore = createDomainStore({ name: "plvs:workspace", backend });

/** Whole-app snapshot of every persisted domain (foundation for problem #5). */
export function exportAll() {
  return { settings: settingsStore.export(), workspace: workspaceStore.export() };
}

/** Wipe every persisted domain (foundation for problem #5). */
export function resetAll() {
  settingsStore.reset();
  workspaceStore.reset();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/persistence/index.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/index.js src/persistence/index.test.js
git commit -m "feat(persistence): add settings/workspace domain stores and exportAll/resetAll"
```

---

## Task 4: Legacy-key cleanup helper

**Files:**
- Create: `src/persistence/cleanupLegacyKeys.js`
- Test: `src/persistence/cleanupLegacyKeys.test.js`

One-shot, best-effort, idempotent removal of the pre-unification localStorage keys. Created here; **wired into boot in Plan 2** (after consumers are migrated — wiring it before migration would wipe data the old code still reads). The old flat plugin-store keys (`captureDeviceId`, `clearShortcut`, `clearGlobal`) are cleaned in Plan 3 when the plugin-store backend lands.

- [ ] **Step 1: Write the failing test**

```js
// src/persistence/cleanupLegacyKeys.test.js
import { afterEach, describe, expect, it } from "vitest";
import { cleanupLegacyKeys, LEGACY_LOCALSTORAGE_KEYS } from "./cleanupLegacyKeys.js";

describe("cleanupLegacyKeys", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("removes every legacy localStorage key", () => {
    for (const key of LEGACY_LOCALSTORAGE_KEYS) localStorage.setItem(key, "x");
    cleanupLegacyKeys();
    for (const key of LEGACY_LOCALSTORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("leaves the new domain keys untouched", () => {
    localStorage.setItem("plvs:settings", "{}");
    localStorage.setItem("plvs:workspace", "{}");
    cleanupLegacyKeys();
    expect(localStorage.getItem("plvs:settings")).toBe("{}");
    expect(localStorage.getItem("plvs:workspace")).toBe("{}");
  });

  it("is idempotent (safe to call when keys are already gone)", () => {
    expect(() => {
      cleanupLegacyKeys();
      cleanupLegacyKeys();
    }).not.toThrow();
  });

  it("covers exactly the five known legacy keys", () => {
    expect(LEGACY_LOCALSTORAGE_KEYS).toEqual([
      "plvs.ui",
      "plvs:workspace:v3",
      "plvs:windowPinned",
      "plvs:closeAction",
      "plvs.captureDeviceId",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/cleanupLegacyKeys.test.js`
Expected: FAIL — cannot resolve `./cleanupLegacyKeys.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/persistence/cleanupLegacyKeys.js
/**
 * One-shot, idempotent removal of pre-unification localStorage keys.
 * No migration: early users reset once (see the design spec, "Migration — none").
 * Wired into boot in Plan 2, after consumers read from the new domain stores.
 */
export const LEGACY_LOCALSTORAGE_KEYS = [
  "plvs.ui",
  "plvs:workspace:v3",
  "plvs:windowPinned",
  "plvs:closeAction",
  "plvs.captureDeviceId",
];

export function cleanupLegacyKeys() {
  if (typeof localStorage === "undefined") return;
  for (const key of LEGACY_LOCALSTORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/persistence/cleanupLegacyKeys.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/cleanupLegacyKeys.js src/persistence/cleanupLegacyKeys.test.js
git commit -m "feat(persistence): add one-shot legacy-key cleanup helper"
```

---

## Task 5: Verify the foundation in isolation

**Files:** none (verification only).

- [ ] **Step 1: Run the full persistence suite**

Run: `npx vitest run src/persistence/`
Expected: PASS — all four test files (23 tests total).

- [ ] **Step 2: Lint the new module**

Run: `npx eslint src/persistence`
Expected: no errors.

- [ ] **Step 3: Format check**

Run: `npx prettier --check "src/persistence/**/*.js"`
Expected: all files formatted. If not, run `npx prettier --write "src/persistence/**/*.js"` and re-commit.

- [ ] **Step 4: Confirm no consumer wiring changed yet**

Run: `git diff --name-only HEAD~5 -- src ':!src/persistence'`
Expected: empty — Plan 1 touches only `src/persistence/`. (Nothing imports the new module yet; that is Plan 2.)

---

## Self-review notes (Plan 1)

- **Spec coverage (this slice):** `createDomainStore` (mechanics + lazy `version ?? 0` + migrate hook) ✓; backend seam with localStorage impl ✓; `settings`/`workspace` stable versionless keys ✓; `exportAll`/`resetAll` ✓; `cleanupLegacyKeys` helper ✓. Consumer migration, `focusId` removal, drag-ratio/dead-code trim, `fullscreenId` runtime-only, plugin-store backend, Rust injection, and window geometry are **explicitly deferred to Plans 2–3**.
- **Type consistency:** backend contract (`get`/`set`/`remove`/`subscribe`) is identical in `localStorageBackend.js`, the `createDomainStore` JSDoc, and the `memoryBackend` test stub. Store surface (`read`/`patch`/`subscribe`/`reset`/`export`) is consistent across `createDomainStore`, `index.js`, and both test files.
- **No placeholders:** every step has complete code and an exact command.
