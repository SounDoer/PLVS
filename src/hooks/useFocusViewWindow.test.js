/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDecorated: vi.fn(async () => true),
  setDecorations: vi.fn(async () => {}),
  setShadow: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isDecorated: mocks.isDecorated,
    setDecorations: mocks.setDecorations,
    setShadow: mocks.setShadow,
  }),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));

import { setWindowDecorations, useFocusViewWindow } from "./useFocusViewWindow.js";

describe("useFocusViewWindow", () => {
  beforeEach(() => {
    mocks.setDecorations.mockClear();
    mocks.isDecorated.mockClear().mockResolvedValue(true);
    mocks.setShadow.mockClear();
    mocks.isTauri.mockReturnValue(true);
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
