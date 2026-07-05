/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const invokeMock = vi.fn().mockResolvedValue(undefined);
const isTauriMock = vi.fn().mockReturnValue(true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeMock(...args),
}));
vi.mock("../ipc/env.js", () => ({
  isTauri: () => isTauriMock(),
}));

const { useGlassEffect } = await import("./useGlassEffect.js");

describe("useGlassEffect", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    isTauriMock.mockReturnValue(true);
  });

  it("invokes set_glass_effect with enabled and dark flags", () => {
    renderHook(() => useGlassEffect(true, false));
    expect(invokeMock).toHaveBeenCalledWith("set_glass_effect", { enabled: true, dark: false });
  });

  it("re-invokes when enabled or dark changes", () => {
    const { rerender } = renderHook(({ enabled, dark }) => useGlassEffect(enabled, dark), {
      initialProps: { enabled: false, dark: false },
    });
    invokeMock.mockClear();
    rerender({ enabled: true, dark: true });
    expect(invokeMock).toHaveBeenCalledWith("set_glass_effect", { enabled: true, dark: true });
  });

  it("does nothing outside Tauri", () => {
    isTauriMock.mockReturnValue(false);
    renderHook(() => useGlassEffect(true, false));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
