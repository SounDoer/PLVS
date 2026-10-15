/** @vitest-environment jsdom */
import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDockAccessories } from "../ipc/commands.js";
import {
  createLatestDockAccessoryUpdater,
  setDockAccessoriesWhenReady,
  useDockAccessoryVisibility,
} from "./useDockAccessoryVisibility.js";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({
  setDockAccessories: vi.fn().mockResolvedValue(undefined),
}));

function renderVisibility(initialProps = {}) {
  return renderHook(
    (props) =>
      useDockAccessoryVisibility({
        active: true,
        edge: "bottom",
        geometryVersion: undefined,
        onError: undefined,
        ...props,
      }),
    { initialProps }
  );
}

const blurStrip = () => act(() => void window.dispatchEvent(new Event("blur")));
const focusStrip = () => act(() => void window.dispatchEvent(new Event("focus")));

describe("useDockAccessoryVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([false, true])(
    "restores the toolbar's prior open state after Snapshot (%s)",
    (wasOpen) => {
      const { result, rerender } = renderVisibility({ snapshotActive: false });
      if (wasOpen) act(() => result.current.toggleToolbar());
      rerender({ snapshotActive: true });
      expect(result.current.headerVisible).toBe(true);
      rerender({ snapshotActive: false });
      expect(result.current.headerVisible).toBe(wasOpen);
    }
  );

  it("allows dismissing Snapshot's toolbar and reveals it again only on the next snapshot", () => {
    const { result, rerender } = renderVisibility({ snapshotActive: true });
    expect(result.current.headerVisible).toBe(true);
    act(() => result.current.toggleToolbar());
    expect(result.current.headerVisible).toBe(false);
    rerender({ snapshotActive: true });
    expect(result.current.headerVisible).toBe(false);
    rerender({ snapshotActive: false });
    rerender({ snapshotActive: true });
    expect(result.current.headerVisible).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.headerVisible).toBe(false);
  });

  it("does not pin the toolbar when it is reopened repeatedly during Snapshot", () => {
    const { result, rerender } = renderVisibility({ snapshotActive: false });
    for (let cycle = 0; cycle < 5; cycle++) {
      rerender({ snapshotActive: true });
      act(() => result.current.toggleToolbar());
      act(() => result.current.toggleToolbar());
      expect(result.current.headerVisible).toBe(true);
      rerender({ snapshotActive: false });
      expect(result.current.headerVisible).toBe(false);
    }
  });

  it("waits for the current header render and ignores late acknowledgements", async () => {
    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    const { result, rerender } = renderVisibility({
      snapshotActive: false,
      waitForHeaderReady: true,
    });
    rerender({ snapshotActive: true, waitForHeaderReady: true });
    const first = result.current.headerPresentationId;
    await flush();
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: false })
    );
    act(() => result.current.confirmHeaderReady(first));
    await flush();
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: true })
    );
    rerender({ snapshotActive: false, waitForHeaderReady: true });
    await flush();
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: false })
    );
    rerender({ snapshotActive: true, waitForHeaderReady: true });
    act(() => result.current.confirmHeaderReady(first));
    await flush();
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: false })
    );
    act(() => result.current.confirmHeaderReady(result.current.headerPresentationId));
    await flush();
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: true })
    );
    act(() => result.current.confirmHeaderReady(first));
    await flush();
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: true })
    );
  });

  it("stays closed until the entry is toggled, and publishes the change", async () => {
    const { result } = renderVisibility();
    expect(result.current.headerVisible).toBe(false);

    act(() => result.current.toggleToolbar());
    expect(result.current.headerVisible).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: true })
    );

    act(() => result.current.toggleToolbar());
    expect(result.current.headerVisible).toBe(false);
  });

  it("closes the editor and the toolbar together when the entry is toggled", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());
    act(() => result.current.openEditor("modules"));

    act(() => result.current.toggleToolbar());

    expect(result.current.editorView).toBeNull();
    expect(result.current.headerVisible).toBe(false);
  });

  it("closes the editor on the first Escape and the toolbar on the second", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());
    act(() => result.current.openEditor("modules"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.editorView).toBeNull();
    expect(result.current.headerVisible).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.headerVisible).toBe(false);
  });

  it("ignores a held Escape, so one long press cannot close the editor and the toolbar", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());
    act(() => result.current.openEditor("modules"));

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape", repeat: true });

    expect(result.current.editorView).toBeNull();
    expect(result.current.headerVisible).toBe(true);
  });

  it("leaves an Escape that something else already handled", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());
    const consume = (event) => event.preventDefault();
    document.addEventListener("keydown", consume, true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", consume, true);

    expect(result.current.headerVisible).toBe(true);
  });

  it("knows the strip already has focus when Dock becomes active", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());

    // No strip focus event ever fired; a header blur alone must not read as leaving PLVS.
    act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: false }));
    act(() => vi.advanceTimersByTime(150));

    expect(result.current.headerVisible).toBe(true);
    hasFocus.mockRestore();
  });

  it("closes once focus has left every Dock window for the grace period", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());

    blurStrip();
    act(() => vi.advanceTimersByTime(149));
    expect(result.current.headerVisible).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.headerVisible).toBe(false);
  });

  it("stays open while focus moves between Dock windows", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());

    blurStrip();
    act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: true }));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.headerVisible).toBe(true);

    act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: false }));
    focusStrip();
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.headerVisible).toBe(true);

    blurStrip();
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.headerVisible).toBe(false);
  });

  it("forgets an accessory's focus once the toolbar has closed", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());
    // The header is hidden while it still claims focus and never reports the blur.
    act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: true }));
    act(() => result.current.toggleToolbar());

    act(() => result.current.toggleToolbar());
    blurStrip();
    act(() => vi.advanceTimersByTime(150));

    expect(result.current.headerVisible).toBe(false);
  });

  it("forgets the editor's focus when the editor closes under an open toolbar", () => {
    const { result } = renderVisibility();
    act(() => result.current.toggleToolbar());
    act(() => result.current.openEditor("modules"));
    // The editor is hidden while it still claims focus and never reports the blur.
    act(() => result.current.onAccessoryFocus({ surface: "dock-editor", focused: true }));
    act(() => result.current.closeEditor());

    act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: true }));
    act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: false }));
    act(() => vi.advanceTimersByTime(150));

    expect(result.current.headerVisible).toBe(false);
  });

  it("treats an entry click as Hide while an error is what shows the toolbar", () => {
    const { result, rerender } = renderVisibility({ forceHeaderVisible: true });

    act(() => result.current.toggleToolbar());
    expect(result.current.headerVisible).toBe(true);

    rerender({ forceHeaderVisible: false });
    expect(result.current.headerVisible).toBe(false);
  });

  it("cannot be dismissed while an error requires attention", () => {
    const { result, rerender } = renderVisibility({ forceHeaderVisible: true });
    expect(result.current.headerVisible).toBe(true);

    act(() => result.current.dismiss());
    blurStrip();
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.headerVisible).toBe(true);

    rerender({ forceHeaderVisible: false });
    expect(result.current.headerVisible).toBe(false);
  });

  it("shows the header for an editor opened without the toolbar and hides it afterwards", () => {
    const { result } = renderVisibility();
    act(() => result.current.openEditor("module:spectrogram"));
    expect(result.current.headerVisible).toBe(true);

    act(() => result.current.closeEditor());
    expect(result.current.headerVisible).toBe(false);
  });

  it("starts closed again after Dock was inactive", () => {
    const { result, rerender } = renderVisibility();
    act(() => result.current.toggleToolbar());

    rerender({ active: false });
    expect(result.current.headerVisible).toBe(false);
    act(() => vi.advanceTimersByTime(0));
    rerender({ active: true });

    expect(result.current.headerVisible).toBe(false);
  });

  it("keeps header and editor visible until the editor closes", () => {
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({
        active: true,
        edge: "top",
        geometryVersion: undefined,
        onError: undefined,
      })
    );
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
        useDockAccessoryVisibility({
          active: true,
          edge: "bottom",
          forceHeaderVisible,
          geometryVersion: undefined,
          onError: undefined,
        }),
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
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({
        active: true,
        edge: "top",
        geometryVersion: undefined,
        onError: undefined,
      })
    );

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
    /** @type {(value: any) => void} */
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
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({
        active: true,
        edge: "top",
        geometryVersion: undefined,
        onError: undefined,
      })
    );
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
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({
        active: true,
        edge: "top",
        geometryVersion: undefined,
        onError: undefined,
      })
    );
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
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({
        active: true,
        edge: "top",
        geometryVersion: undefined,
        onError: undefined,
      })
    );
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
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({
        active: true,
        edge: "top",
        geometryVersion: undefined,
        onError: undefined,
      })
    );
    act(() => result.current.openEditor("modules"));
    act(() => result.current.resizeEditor({ view: "modules", width: 188, height: 386 }));
    act(() => result.current.openEditor("module:spectrogram"));
    act(() => result.current.closeEditor("module:spectrogram", "blur"));

    expect(result.current.editorView).toBe("module:spectrogram");

    act(() => result.current.resizeEditor({ view: "module:spectrogram", width: 280, height: 180 }));
    act(() => result.current.closeEditor("module:spectrogram", "blur"));

    expect(result.current.editorView).toBeNull();
  });
  it("settles while inactive instead of rescheduling its own reset", async () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useDockAccessoryVisibility({
        active: false,
        edge: "bottom",
        geometryVersion: undefined,
        onError: undefined,
      });
    });

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(0);
        await Promise.resolve();
      });
    }
    const settledRenders = renders;

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(renders).toBe(settledRenders);
    expect(vi.getTimerCount()).toBe(0);
  });
});
