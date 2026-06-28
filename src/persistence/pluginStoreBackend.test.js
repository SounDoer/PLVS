import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = [];
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      set: vi.fn(async (k, v) => saved.push([k, v])),
      save: vi.fn(async () => {}),
      delete: vi.fn(async (k) => saved.push(["__delete__", k])),
    })),
  },
}));

describe("pluginStoreBackend", () => {
  beforeEach(() => {
    vi.resetModules();
    saved.length = 0;
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
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget persist run
    expect(saved).toContainEqual([
      "plvs:presets",
      { list: [{ id: "p1", name: "Preset" }], activeId: "p1" },
    ]);
  });

  it("remove clears the cache and schedules a delete", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.remove("plvs:settings");
    expect(backend.get("plvs:settings")).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toContainEqual(["__delete__", "plvs:settings"]);
  });

  it("can suspend queued persistence before profile import/reset", async () => {
    const { createPluginStoreBackend, suspendPluginStorePersistence } =
      await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:settings", { referenceLufs: -18 });
    suspendPluginStorePersistence();

    await new Promise((r) => setTimeout(r, 0));
    expect(saved).not.toContainEqual(["plvs:settings", { referenceLufs: -18 }]);

    backend.set("plvs:settings", { referenceLufs: -12 });
    await new Promise((r) => setTimeout(r, 0));
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
});
