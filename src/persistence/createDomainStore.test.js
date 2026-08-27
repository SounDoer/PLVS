// src/persistence/createDomainStore.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      return () =>
        subs.set(
          key,
          (subs.get(key) || []).filter((f) => f !== fn)
        );
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

describe("createDomainStore coalesced writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function countingBackend() {
    const inner = memoryBackend();
    let writes = 0;
    return {
      ...inner,
      set: (key, value) => {
        writes += 1;
        inner.set(key, value);
      },
      get writes() {
        return writes;
      },
    };
  }

  it("collapses a burst of patches into a single write", () => {
    const backend = countingBackend();
    const store = createDomainStore({ name: "d", backend });

    for (let i = 0; i < 100; i += 1) store.patchCoalesced({ opacity: i });
    expect(backend.writes).toBe(0);

    vi.advanceTimersByTime(250);
    expect(backend.writes).toBe(1);
    expect(store.read()).toEqual({ opacity: 99 });
  });

  it("does not let pending values shadow a write that arrived from outside", () => {
    const backend = countingBackend();
    const store = createDomainStore({ name: "d", backend });

    store.patchCoalesced({ opacity: 42 });
    // A boot that seeds storage directly, or another window writing the same key.
    backend.set("d", { restored: true });

    expect(store.read()).toEqual({ restored: true });
  });

  it("export flushes pending so a snapshot is never missing an in-flight value", () => {
    const backend = countingBackend();
    const store = createDomainStore({ name: "d", backend });
    store.patch({ kept: 1 });

    store.patchCoalesced({ opacity: 42 });
    expect(store.export()).toEqual({ kept: 1, opacity: 42 });
    expect(store.read()).toEqual({ kept: 1, opacity: 42 });
  });

  it("notifies same-context listeners when the value lands, not before", () => {
    const backend = countingBackend();
    const store = createDomainStore({ name: "d", backend, notifySameContext: true });
    const seen = [];
    store.subscribe(() => seen.push(store.read().opacity));

    store.patchCoalesced({ opacity: 5 });
    expect(seen).toEqual([]);

    vi.advanceTimersByTime(250);
    // The stub backend also fans out on `set`, standing in for a cross-context storage event, so
    // assert on what every listener saw rather than on how many times they were called.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === 5)).toBe(true);
  });

  it("a synchronous patch carries pending values with it and cancels the timer", () => {
    const backend = countingBackend();
    const store = createDomainStore({ name: "d", backend });

    store.patchCoalesced({ opacity: 7 });
    store.patch({ other: true });

    expect(store.read()).toEqual({ opacity: 7, other: true });
    const writesAfterPatch = backend.writes;
    vi.advanceTimersByTime(250);
    expect(backend.writes).toBe(writesAfterPatch);
  });

  it("flush writes immediately and reset drops pending values", () => {
    const backend = countingBackend();
    const store = createDomainStore({ name: "d", backend });

    store.patchCoalesced({ opacity: 3 });
    store.flush();
    expect(backend.writes).toBe(1);
    expect(store.read()).toEqual({ opacity: 3 });

    store.patchCoalesced({ opacity: 9 });
    store.reset();
    vi.advanceTimersByTime(250);
    expect(store.read()).toEqual({});
  });
});
