/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setDecorations: vi.fn(async () => {}),
  setShadow: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setDecorations: mocks.setDecorations,
    setShadow: mocks.setShadow,
  }),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));

import { useFocusViewWindow } from "./useFocusViewWindow.js";

describe("useFocusViewWindow", () => {
  beforeEach(() => {
    mocks.setDecorations.mockClear();
    mocks.setShadow.mockClear();
    mocks.isTauri.mockReturnValue(true);
  });

  it("applies decorations and shadow from the view flags", () => {
    renderHook(() => useFocusViewWindow(false, false));
    expect(mocks.setDecorations).toHaveBeenCalledWith(true);
    expect(mocks.setShadow).toHaveBeenCalledWith(true);
  });

  it("strips chrome when frameless", () => {
    renderHook(() => useFocusViewWindow(true, false));
    expect(mocks.setDecorations).toHaveBeenCalledWith(false);
    expect(mocks.setShadow).toHaveBeenCalledWith(false);
  });

  it("skips all window calls while suspended (docked boot must keep strip chrome)", () => {
    renderHook(() => useFocusViewWindow(false, false, { suspended: true }));
    expect(mocks.setDecorations).not.toHaveBeenCalled();
    expect(mocks.setShadow).not.toHaveBeenCalled();
  });

  it("re-applies the user's attributes when unsuspended (dock exit)", () => {
    const { rerender } = renderHook(
      ({ suspended }) => useFocusViewWindow(false, false, { suspended }),
      {
        initialProps: { suspended: true },
      }
    );
    expect(mocks.setDecorations).not.toHaveBeenCalled();

    rerender({ suspended: false });
    expect(mocks.setDecorations).toHaveBeenCalledWith(true);
    expect(mocks.setShadow).toHaveBeenCalledWith(true);
  });
});
