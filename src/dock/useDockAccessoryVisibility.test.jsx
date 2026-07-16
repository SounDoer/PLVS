/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDockAccessories } from "../ipc/commands.js";
import {
  setDockAccessoriesWhenReady,
  useDockAccessoryVisibility,
} from "./useDockAccessoryVisibility.js";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ setDockAccessories: vi.fn().mockResolvedValue(undefined) }));

describe("useDockAccessoryVisibility", () => {
  beforeEach(() => vi.useFakeTimers());
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
