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
