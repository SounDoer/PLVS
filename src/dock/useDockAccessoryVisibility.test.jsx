/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorOverDockSurfaces, setDockAccessories } from "../ipc/commands.js";
import {
  createLatestDockAccessoryUpdater,
  setDockAccessoriesWhenReady,
  useDockAccessoryVisibility,
} from "./useDockAccessoryVisibility.js";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({
  cursorOverDockSurfaces: vi.fn().mockResolvedValue(true),
  setDockAccessories: vi.fn().mockResolvedValue(undefined),
}));

describe("useDockAccessoryVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cursorOverDockSurfaces.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows on strip enter and hides immediately after both surfaces are left", async () => {
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({ active: true, edge: "bottom" })
    );
    act(() => result.current.onStripPointerEnter());
    await act(async () => Promise.resolve());
    expect(result.current.headerVisible).toBe(true);
    act(() => result.current.onStripPointerLeave());
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.headerVisible).toBe(false);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: false })
    );
  });

  it("repairs a missed pointer leave from live native window geometry", async () => {
    cursorOverDockSurfaces.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({ active: true, edge: "bottom" })
    );

    act(() => result.current.onStripPointerEnter());
    expect(result.current.headerVisible).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(33);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(0));

    expect(result.current.headerVisible).toBe(false);
    expect(cursorOverDockSurfaces).toHaveBeenCalledOnce();
  });

  it("repairs a missed re-enter after native geometry hid the header", async () => {
    cursorOverDockSurfaces.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({ active: true, edge: "bottom" })
    );

    act(() => result.current.onStripPointerEnter());
    await act(async () => {
      vi.advanceTimersByTime(33);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.headerVisible).toBe(false);

    cursorOverDockSurfaces.mockResolvedValue(true);
    await act(async () => {
      vi.advanceTimersByTime(33);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(0));

    expect(result.current.headerVisible).toBe(true);
    expect(cursorOverDockSurfaces).toHaveBeenCalledTimes(2);
  });

  it("does not fight reliable DOM enter and leave events when native geometry agrees", async () => {
    cursorOverDockSurfaces.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({ active: true, edge: "bottom" })
    );

    act(() => result.current.onStripPointerEnter());
    await act(async () => {
      vi.advanceTimersByTime(33);
      await Promise.resolve();
    });
    expect(result.current.headerVisible).toBe(true);

    cursorOverDockSurfaces.mockResolvedValue(false);
    act(() => result.current.onStripPointerLeave());
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.headerVisible).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(33);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.headerVisible).toBe(false);
  });

  it("does not let a stale cursor result overwrite a newer pointer enter", async () => {
    let resolveCursor;
    cursorOverDockSurfaces.mockReturnValue(
      new Promise((resolve) => {
        resolveCursor = resolve;
      })
    );
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({ active: true, edge: "bottom" })
    );

    act(() => result.current.onStripPointerEnter());
    act(() => vi.advanceTimersByTime(33));
    act(() => result.current.onAccessoryPointer({ surface: "dock-header", inside: true }));
    await act(async () => resolveCursor(false));

    expect(result.current.headerVisible).toBe(true);
  });

  it("keeps header and editor visible until the editor closes", () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));
    act(() => result.current.openEditor("modules"));
    expect(result.current.editorView).toBe("modules");
    expect(result.current.headerVisible).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.headerVisible).toBe(true);
    act(() => result.current.closeEditor());
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.editorView).toBeNull();
    expect(result.current.headerVisible).toBe(false);
  });

  it("does not reconcile hover while an editor or forced error keeps the header open", () => {
    const { result, rerender } = renderHook(
      ({ forceHeaderVisible }) =>
        useDockAccessoryVisibility({ active: true, edge: "top", forceHeaderVisible }),
      { initialProps: { forceHeaderVisible: false } }
    );

    act(() => result.current.openEditor("presets"));
    act(() => vi.advanceTimersByTime(1000));
    expect(cursorOverDockSurfaces).not.toHaveBeenCalled();

    act(() => result.current.closeEditor());
    rerender({ forceHeaderVisible: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(cursorOverDockSurfaces).not.toHaveBeenCalled();
  });

  it("stops reconciliation across preset-style Dock exit and restarts with live geometry", async () => {
    const { result, rerender } = renderHook(
      ({ active, edge }) => useDockAccessoryVisibility({ active, edge }),
      { initialProps: { active: true, edge: "bottom" } }
    );

    act(() => result.current.onStripPointerEnter());
    rerender({ active: true, edge: "top" });
    await act(async () => {
      vi.advanceTimersByTime(33);
      await Promise.resolve();
    });
    expect(cursorOverDockSurfaces).toHaveBeenCalledOnce();

    rerender({ active: false, edge: "top" });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.headerVisible).toBe(false);
    expect(cursorOverDockSurfaces).toHaveBeenCalledOnce();
  });

  it("keeps the header visible while an error requires attention", async () => {
    const { result, rerender } = renderHook(
      ({ forceHeaderVisible }) =>
        useDockAccessoryVisibility({ active: true, edge: "bottom", forceHeaderVisible }),
      { initialProps: { forceHeaderVisible: false } }
    );

    rerender({ forceHeaderVisible: true });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.headerVisible).toBe(true);

    rerender({ forceHeaderVisible: false });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.headerVisible).toBe(false);
  });

  it("ignores a delayed blur close from the editor that was just replaced", () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));

    act(() => result.current.openEditor("modules"));
    act(() => result.current.openEditor("presets", 480));
    act(() => result.current.closeEditor("modules"));

    expect(result.current.editorView).toBe("presets");
  });

  it("retries while accessory windows are still registering", async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(new Error("dock editor window unavailable"))
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const options = {
      edge: "bottom",
      headerVisible: false,
      editorVisible: false,
      editorWidth: 400,
      editorHeight: 480,
    };

    await expect(setDockAccessoriesWhenReady(options, { command, wait })).resolves.toBeUndefined();

    expect(command).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenNthCalledWith(1, options);
    expect(command).toHaveBeenNthCalledWith(2, options);
    expect(wait).toHaveBeenCalledWith(50);
  });

  it("does not retry unrelated native failures", async () => {
    const error = new Error("dock editor position: access denied");
    const command = vi.fn().mockRejectedValue(error);
    const wait = vi.fn();

    await expect(
      setDockAccessoriesWhenReady(
        {
          edge: "top",
          headerVisible: true,
          editorVisible: true,
          editorWidth: 400,
          editorHeight: 480,
        },
        { command, wait }
      )
    ).rejects.toBe(error);

    expect(command).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("coalesces rapid accessory updates to the latest state", async () => {
    let resolveFirst;
    const command = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValue(undefined);
    const updater = createLatestDockAccessoryUpdater({ command });

    updater.update({ headerVisible: false });
    updater.update({ headerVisible: true });
    updater.update({ headerVisible: false });
    updater.update({ headerVisible: true });

    expect(command).toHaveBeenCalledOnce();
    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(command).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenLastCalledWith({ headerVisible: true });
  });

  it("keeps the editor hidden until its intrinsic dimensions are measured", async () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));
    act(() => result.current.openEditor("presets", 480));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ editorVisible: false, editorAnchorX: 480 })
    );

    act(() => result.current.resizeEditor({ view: "presets", width: 238.2, height: 146.4 }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({
        editorVisible: true,
        editorWidth: 239,
        editorHeight: 147,
        editorAnchorX: 480,
      })
    );
  });

  it("keeps a measured editor visible while an internal replacement is measured", async () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));
    act(() => result.current.openEditor("modules"));
    act(() => result.current.resizeEditor({ view: "modules", width: 188, height: 386 }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => result.current.openEditor("module:spectrogram"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({
        editorVisible: true,
        editorWidth: 188,
        editorHeight: 386,
      })
    );
  });

  it("ignores a stale measurement from the editor that was just replaced", async () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));
    act(() => result.current.openEditor("modules"));
    act(() => result.current.openEditor("presets"));
    act(() => result.current.resizeEditor({ view: "modules", width: 320, height: 240 }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ editorVisible: false })
    );
  });

  it("ignores blur while an internal replacement is being measured", () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));
    act(() => result.current.openEditor("modules"));
    act(() => result.current.resizeEditor({ view: "modules", width: 188, height: 386 }));
    act(() => result.current.openEditor("module:spectrogram"));
    act(() => result.current.closeEditor("module:spectrogram", "blur"));

    expect(result.current.editorView).toBe("module:spectrogram");

    act(() => result.current.resizeEditor({ view: "module:spectrogram", width: 280, height: 180 }));
    act(() => result.current.closeEditor("module:spectrogram", "blur"));

    expect(result.current.editorView).toBeNull();
  });
});
