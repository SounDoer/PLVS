/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCloseActionSetting } from "./useCloseActionSetting.js";
import { useCloseConfirm } from "./useCloseConfirm.js";
import { settingsStore } from "../persistence/index.js";

describe("useCloseActionSetting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to ask when no close action is stored", () => {
    const { result } = renderHook(() => useCloseActionSetting());

    expect(result.current.closeAction).toBe("ask");
  });

  it("reads a stored close action", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "tray" }));

    const { result } = renderHook(() => useCloseActionSetting());

    expect(result.current.closeAction).toBe("tray");
  });

  it("persists non-default close actions", () => {
    const { result } = renderHook(() => useCloseActionSetting());

    act(() => {
      result.current.setCloseAction("quit");
    });

    expect(result.current.closeAction).toBe("quit");
    expect(JSON.parse(localStorage.getItem("plvs:settings")).closeAction).toBe("quit");
  });

  it("removes the stored key when reset to the default", () => {
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ closeAction: "quit", referenceLufs: -18 })
    );
    const { result } = renderHook(() => useCloseActionSetting());

    act(() => {
      settingsStore.patchCoalesced({ surfaceOpacity: 61 });
      result.current.setCloseAction("ask");
    });

    expect(result.current.closeAction).toBe("ask");
    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toEqual({
      referenceLufs: -18,
      surfaceOpacity: 61,
    });
  });

  it("updates the open Settings owner when the close dialog saves a choice", async () => {
    const { result } = renderHook(() => ({
      setting: useCloseActionSetting(),
      close: useCloseConfirm({ onHideWindow: async () => {} }),
    }));

    await act(() => result.current.close.handleConfirm("tray", true));

    expect(result.current.setting.closeAction).toBe("tray");
    expect(settingsStore.read().closeAction).toBe("tray");
  });
});
