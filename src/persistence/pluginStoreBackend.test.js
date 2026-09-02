/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = [];
const storeSet = vi.fn(async (k, v) => saved.push([k, v]));
const storeSave = vi.fn(async () => {});
const storeDelete = vi.fn(async (k) => saved.push(["__delete__", k]));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      set: storeSet,
      save: storeSave,
      delete: storeDelete,
    })),
  },
}));

describe("pluginStoreBackend", () => {
  beforeEach(() => {
    vi.resetModules();
    saved.length = 0;
    storeSet.mockReset().mockImplementation(async (k, v) => saved.push([k, v]));
    storeSave.mockReset().mockImplementation(async () => {});
    storeDelete.mockReset().mockImplementation(async (k) => saved.push(["__delete__", k]));
    globalThis.window = globalThis.window || {};
    window.__PLVS_INITIAL_STATE__ = {
      "plvs:settings": { referenceLufs: -20 },
      "plvs:presets": { list: [], activeId: null },
    };
  });
  afterEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
    vi.clearAllMocks();
  });

  it("get reads synchronously from the injected initial state", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    expect(backend.get("plvs:settings")).toEqual({ referenceLufs: -20 });
    expect(backend.get("plvs:presets")).toEqual({ list: [], activeId: null });
    expect(backend.get("plvs:workspace")).toBeNull();
  });

  it("set updates the cache synchronously and schedules an async persist", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:presets", { list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    expect(backend.get("plvs:presets")).toEqual({
      list: [{ id: "p1", name: "Preset" }],
      activeId: "p1",
    }); // sync
    await new Promise((r) => setTimeout(r, 250)); // let the trailing flush run
    expect(saved).toContainEqual([
      "plvs:presets",
      { list: [{ id: "p1", name: "Preset" }], activeId: "p1" },
    ]);
  });

  it("coalesces a burst of set() calls into a single save", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    for (let i = 0; i < 20; i++) {
      backend.set("plvs:settings", { referenceLufs: -20 + i });
    }
    await new Promise((r) => setTimeout(r, 250));
    const settingsWrites = saved.filter(([k]) => k === "plvs:settings");
    expect(settingsWrites).toEqual([["plvs:settings", { referenceLufs: -1 }]]);
  });

  it("remove clears the cache and schedules a delete", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.remove("plvs:settings");
    expect(backend.get("plvs:settings")).toBeNull();
    await new Promise((r) => setTimeout(r, 250));
    expect(saved).toContainEqual(["__delete__", "plvs:settings"]);
  });

  it("can suspend queued persistence before profile import/reset", async () => {
    const { createPluginStoreBackend, suspendPluginStorePersistence } =
      await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:settings", { referenceLufs: -18 });
    suspendPluginStorePersistence();

    await new Promise((r) => setTimeout(r, 250));
    expect(saved).not.toContainEqual(["plvs:settings", { referenceLufs: -18 }]);

    backend.set("plvs:settings", { referenceLufs: -12 });
    await new Promise((r) => setTimeout(r, 250));
    expect(saved).not.toContainEqual(["plvs:settings", { referenceLufs: -12 }]);
  });

  it("flushes pending persistence before authoritative profile export", async () => {
    const { createPluginStoreBackend, flushPluginStorePersistence } =
      await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:presets", { list: [{ id: "p1", name: "Preset" }], activeId: "p1" });

    await flushPluginStorePersistence();

    expect(saved).toContainEqual([
      "plvs:presets",
      { list: [{ id: "p1", name: "Preset" }], activeId: "p1" },
    ]);
  });

  it("backend.flush() forces the pending batch to run immediately", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:settings", { referenceLufs: -18 });
    await backend.flush();
    expect(saved).toContainEqual(["plvs:settings", { referenceLufs: -18 }]);
  });

  it("backend.flush() waits for both set operations and save()", async () => {
    let releaseSet;
    let releaseSave;
    storeSet.mockImplementationOnce(
      () => new Promise((resolve) => (releaseSet = () => resolve(undefined)))
    );
    storeSave.mockImplementationOnce(
      () => new Promise((resolve) => (releaseSave = () => resolve(undefined)))
    );
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:settings", { referenceLufs: -17 });

    let settled = false;
    const flushing = backend.flush().then(() => (settled = true));
    await vi.waitFor(() => expect(releaseSet).toBeTypeOf("function"));
    expect(storeSave).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    releaseSet();
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf("function"));
    expect(settled).toBe(false);

    releaseSave();
    await flushing;
    expect(settled).toBe(true);
  });

  it("reports the original persistence failure once and allows a later flush to succeed", async () => {
    const failure = new Error("disk full");
    storeSave.mockRejectedValueOnce(failure);
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:settings", { referenceLufs: -16 });

    await expect(backend.flush()).rejects.toBe(failure);

    backend.set("plvs:settings", { referenceLufs: -15 });
    await expect(backend.flush()).resolves.toBeUndefined();
  });
});
