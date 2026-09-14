/** @vitest-environment jsdom */
import { Activity } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCK_HISTORY_DEFAULT_WINDOW_SEC,
  clampDockHistoryWindow,
  useDockHistoryViewport,
} from "./useDockHistoryViewport.js";

describe("useDockHistoryViewport", () => {
  let rafCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallback = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      rafCallback = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the normal 1 minute default and clamps to shared history limits", () => {
    expect(DOCK_HISTORY_DEFAULT_WINDOW_SEC).toBe(60);
    expect(clampDockHistoryWindow(1, 3600)).toBe(5);
    expect(clampDockHistoryWindow(9000, 3600)).toBe(3600);
  });

  it("zooms the shared latest-locked window and identifies the active HUD panel", () => {
    const { result } = renderHook(() => useDockHistoryViewport({ maxWindowSec: 3600 }));

    act(() => result.current.onDockHistoryWheel("waveform-1", -1));
    act(() => rafCallback());

    expect(result.current.dockHistoryWindowSec).toBe(51);
    expect(result.current.dockHistoryHud).toEqual({ panelId: "waveform-1", windowSec: 51 });
  });

  it("keeps zooming after its effects are torn down with a wheel frame pending", () => {
    // Cancel for real, so the frame queued before the teardown can never run and reset the ref.
    const frames = new Map();
    let nextFrameId = 1;
    window.requestAnimationFrame.mockImplementation((callback) => {
      frames.set(nextFrameId, callback);
      return nextFrameId++;
    });
    window.cancelAnimationFrame.mockImplementation((id) => frames.delete(id));
    // Hidden Activity runs effect cleanups but keeps refs, as StrictMode and Fast Refresh do.
    let mode = "visible";
    const wrapper = ({ children }) => <Activity mode={mode}>{children}</Activity>;
    const { result, rerender } = renderHook(() => useDockHistoryViewport({ maxWindowSec: 3600 }), {
      wrapper,
    });

    act(() => result.current.onDockHistoryWheel("waveform-1", -1));
    mode = "hidden";
    rerender();
    mode = "visible";
    rerender();
    act(() => result.current.onDockHistoryWheel("waveform-1", -1));
    act(() => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback();
      }
    });

    // The wheel before the teardown still carries its factor, so the exact width is not the point:
    // the window must have moved off the 60 s default at all.
    expect(result.current.dockHistoryWindowSec).toBeLessThan(60);
  });

  it("resets on a same-panel right-button double press and clamps when retention shrinks", () => {
    const { result, rerender } = renderHook(
      ({ maxWindowSec }) => useDockHistoryViewport({ maxWindowSec }),
      { initialProps: { maxWindowSec: 3600 } }
    );
    act(() => result.current.onDockHistoryWheel("spectrogram-1", 1));
    act(() => rafCallback());
    expect(result.current.dockHistoryWindowSec).toBeGreaterThan(60);

    act(() => {
      result.current.onDockHistoryPointerDown("spectrogram-1", 2, 1000);
      result.current.onDockHistoryPointerDown("spectrogram-1", 2, 1200);
    });
    expect(result.current.dockHistoryWindowSec).toBe(60);

    rerender({ maxWindowSec: 30 });
    expect(result.current.dockHistoryWindowSec).toBe(30);
  });
});
