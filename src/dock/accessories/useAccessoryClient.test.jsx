/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitReady: vi.fn(async () => {}),
  emitFocus: vi.fn(async () => {}),
  listenState: vi.fn(),
}));

vi.mock("../../ipc/dockAccessoryEvents.js", () => ({
  emitDockAccessoryAction: vi.fn(async () => {}),
  emitDockAccessoryFocus: mocks.emitFocus,
  emitDockAccessoryReady: mocks.emitReady,
  listenDockAccessoryState: mocks.listenState,
}));

import { useAccessoryClient } from "./useAccessoryClient.js";

describe("useAccessoryClient", () => {
  let stateHandler;

  beforeEach(() => {
    mocks.emitReady.mockClear();
    mocks.emitFocus.mockClear();
    mocks.listenState.mockReset();
    stateHandler = null;
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeRevision;
  });

  it("reports its own window focus to the main window", () => {
    mocks.listenState.mockResolvedValue(() => {});
    const { unmount } = renderHook(() => useAccessoryClient("dock-header"));

    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("blur"));
    });
    unmount();
    act(() => void window.dispatchEvent(new Event("focus")));

    expect(mocks.emitFocus.mock.calls).toEqual([
      [{ surface: "dock-header", focused: true }],
      [{ surface: "dock-header", focused: false }],
    ]);
  });

  it("announces ready only after the state listener is registered", async () => {
    let finishRegistration;
    mocks.listenState.mockImplementation(
      () => new Promise((resolve) => (finishRegistration = () => resolve(() => {})))
    );

    const { unmount } = renderHook(() => useAccessoryClient("dock-header"));

    expect(mocks.listenState).toHaveBeenCalledOnce();
    expect(mocks.emitReady).not.toHaveBeenCalled();

    await act(async () => finishRegistration());

    expect(mocks.emitReady).toHaveBeenCalledWith("dock-header");
    unmount();
  });

  it("updates accessory text size and ignores stale size publications", async () => {
    mocks.listenState.mockImplementation((handler) => {
      stateHandler = handler;
      return Promise.resolve(() => {});
    });
    const { unmount } = renderHook(() => useAccessoryClient("dock-editor"));
    await act(async () => {});
    act(() => {
      stateHandler({ surface: "dock-editor", revision: 1, payload: { interfaceSize: "small" } });
    });
    expect(document.documentElement.style.getPropertyValue("--ui-fs-display")).toBe("13px");
    act(() => {
      stateHandler({
        surface: "dock-editor",
        revision: 3,
        payload: { interfaceSize: "extra-large" },
      });
      stateHandler({ surface: "dock-editor", revision: 2, payload: { interfaceSize: "small" } });
    });
    expect(document.documentElement.style.getPropertyValue("--ui-fs-display")).toBe("18px");
    unmount();
  });

  it("applies the latest theme publication and rejects a stale accessory revision", async () => {
    mocks.listenState.mockImplementation((handler) => {
      stateHandler = handler;
      return Promise.resolve(() => {});
    });
    const { unmount } = renderHook(() => useAccessoryClient("dock-header"));
    await act(async () => {});

    act(() => {
      stateHandler({
        surface: "dock-header",
        revision: 4,
        payload: {
          theme: {
            id: "custom-light",
            revision: 9,
            colorScheme: "light",
            css: { "--background": "#ffffff" },
          },
        },
      });
      stateHandler({
        surface: "dock-header",
        revision: 3,
        payload: {
          theme: {
            id: "stale-dark",
            revision: 8,
            colorScheme: "dark",
            css: { "--background": "#000000" },
          },
        },
      });
    });

    expect(document.documentElement.dataset.theme).toBe("custom-light");
    expect(document.documentElement.dataset.themeRevision).toBe("9");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#ffffff");
    unmount();
  });
});
