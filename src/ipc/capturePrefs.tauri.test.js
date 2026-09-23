/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const loadStore = vi.fn();

describe("capturePrefs transactional desktop persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    loadStore.mockReset();
    localStorage.clear();
    window.__PLVS_INITIAL_STATE__ = {
      captureDeviceId: "app-00112233445566778899aabbccddeeff",
      multiInstancePersistence: { itemRevisions: {}, collectionRevisions: {} },
    };
    vi.doMock("./env.js", () => ({ isTauri: () => true }));
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-store", () => ({ Store: { load: loadStore } }));
  });

  it("loads the Source from the owning workspace boot snapshot", async () => {
    const { loadCaptureDeviceId } = await import("./capturePrefs.js");

    await expect(loadCaptureDeviceId()).resolves.toBe("app-00112233445566778899aabbccddeeff");
    expect(loadStore).not.toHaveBeenCalled();
  });

  it("saves the Source to the owning workspace without touching shared legacy storage", async () => {
    const { saveCaptureDeviceId, LEGACY_CAPTURE_DEVICE_LS_KEY } = await import("./capturePrefs.js");

    await saveCaptureDeviceId("out:2");

    expect(invoke).toHaveBeenCalledWith("persistence_save_workspace_value", {
      key: "captureDeviceId",
      value: "out:2",
    });
    expect(loadStore).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_CAPTURE_DEVICE_LS_KEY)).toBeNull();
  });
});
