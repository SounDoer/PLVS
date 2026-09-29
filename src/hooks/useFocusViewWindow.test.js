/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDecorated: vi.fn(async () => true),
  setDecorations: vi.fn(async () => {}),
  invoke: vi.fn(async () => {}),
  setShadow: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
  isMacOS: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isDecorated: mocks.isDecorated,
    setDecorations: mocks.setDecorations,
    setShadow: mocks.setShadow,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("../lib/platform.js", () => ({ isMacOS: mocks.isMacOS }));

import { setWindowDecorations, useFocusViewWindow } from "./useFocusViewWindow.js";

describe("useFocusViewWindow", () => {
  beforeEach(() => {
    mocks.setDecorations.mockClear();
    mocks.isDecorated.mockClear().mockResolvedValue(true);
    mocks.invoke.mockClear();
    mocks.setShadow.mockClear();
    mocks.isTauri.mockReturnValue(true);
    mocks.isMacOS.mockReturnValue(false);
  });

  it("does not reapply decorations when the window already has the requested chrome", async () => {
    mocks.isDecorated.mockResolvedValue(false);

    await expect(setWindowDecorations(false)).resolves.toBe(false);

    expect(mocks.setDecorations).not.toHaveBeenCalled();
  });

  it("does not reapply shadow when startup chrome already matches Focus View", async () => {
    mocks.isDecorated.mockResolvedValue(false);

    renderHook(() => useFocusViewWindow(true, true));

    await waitFor(() => expect(mocks.isDecorated).toHaveBeenCalled());
    expect(mocks.setDecorations).not.toHaveBeenCalled();
    expect(mocks.setShadow).not.toHaveBeenCalled();
  });

  it("applies decorations from the view flags", async () => {
    mocks.isDecorated.mockResolvedValue(false);
    renderHook(() => useFocusViewWindow(false, false));
    await waitFor(() => expect(mocks.setDecorations).toHaveBeenCalledWith(true));
  });

  it("strips decorations when frameless but leaves the Rust-owned shadow alone", async () => {
    renderHook(() => useFocusViewWindow(true, false));
    await waitFor(() => expect(mocks.setDecorations).toHaveBeenCalledWith(false));
    expect(mocks.setShadow).not.toHaveBeenCalled();
  });

  it("resynchronizes the macOS webview after changing decorations", async () => {
    mocks.isMacOS.mockReturnValue(true);

    await expect(setWindowDecorations(false)).resolves.toBe(true);

    expect(mocks.invoke).toHaveBeenCalledWith("sync_main_window_chrome");
  });

  it.each([true, false])(
    "synchronizes the native outline after setting decorations to %s",
    async (enabled) => {
      mocks.isDecorated.mockResolvedValue(!enabled);
      await setWindowDecorations(enabled);
      expect(mocks.invoke).toHaveBeenCalledWith("sync_main_window_chrome");
      expect(mocks.setDecorations.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.invoke.mock.invocationCallOrder[0]
      );
    }
  );

  it("skips all window calls while suspended (docked boot must keep strip chrome)", () => {
    renderHook(() => useFocusViewWindow(false, false, { suspended: true }));
    expect(mocks.setDecorations).not.toHaveBeenCalled();
    expect(mocks.setShadow).not.toHaveBeenCalled();
  });

  it("re-applies the user's attributes when unsuspended (dock exit)", async () => {
    mocks.isDecorated.mockResolvedValue(false);
    const { rerender } = renderHook(
      ({ suspended }) => useFocusViewWindow(false, false, { suspended }),
      {
        initialProps: { suspended: true },
      }
    );
    expect(mocks.setDecorations).not.toHaveBeenCalled();

    rerender({ suspended: false });
    await waitFor(() => expect(mocks.setDecorations).toHaveBeenCalledWith(true));
  });
});
