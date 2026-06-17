import { afterEach, describe, expect, it, vi } from "vitest";

describe("persistence backend selection", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete window.__PLVS_INITIAL_STATE__;
  });

  it("uses the plugin-store backend under Tauri", async () => {
    vi.doMock("../ipc/env.js", () => ({ isTauri: () => true }));
    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: { load: vi.fn(async () => ({ set: vi.fn(), save: vi.fn(), delete: vi.fn() })) },
    }));
    window.__PLVS_INITIAL_STATE__ = { "plvs:settings": { referenceLufs: -19 } };
    const { settingsStore } = await import("./index.js");
    expect(settingsStore.read()).toEqual({ referenceLufs: -19 });
  });

  it("uses localStorage when not under Tauri", async () => {
    vi.doMock("../ipc/env.js", () => ({ isTauri: () => false }));
    localStorage.setItem("plvs:settings", JSON.stringify({ referenceLufs: -12 }));
    const { settingsStore } = await import("./index.js");
    expect(settingsStore.read()).toEqual({ referenceLufs: -12 });
    localStorage.clear();
  });
});
