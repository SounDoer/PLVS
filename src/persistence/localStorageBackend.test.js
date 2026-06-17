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
