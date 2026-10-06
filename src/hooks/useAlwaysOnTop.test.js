/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";

const mockSetAlwaysOnTop = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: mockSetAlwaysOnTop }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

function renderEffect(initialProps) {
  return renderHook(({ pinned, suspended }) => useAlwaysOnTop(pinned, { suspended }), {
    initialProps,
  });
}

describe("useAlwaysOnTop", () => {
  beforeEach(() => {
    mockSetAlwaysOnTop.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("calls setAlwaysOnTop(false) on mount when unpinned", () => {
    renderEffect({ pinned: false, suspended: false });
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("calls setAlwaysOnTop(true) on mount when pinned", () => {
    renderEffect({ pinned: true, suspended: false });
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("applies a changed value", () => {
    const { rerender } = renderEffect({ pinned: false, suspended: false });
    mockSetAlwaysOnTop.mockClear();

    rerender({ pinned: true, suspended: false });

    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("skips setAlwaysOnTop while suspended (docked strip keeps Rust-owned topmost)", () => {
    const { rerender } = renderEffect({ pinned: true, suspended: true });
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();

    rerender({ pinned: false, suspended: true });

    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("re-asserts the pin when unsuspended (dock exit)", () => {
    const { rerender } = renderEffect({ pinned: true, suspended: true });
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();

    rerender({ pinned: true, suspended: false });
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
