/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppGlobalEffects } from "./useAppGlobalEffects.js";

const mocks = vi.hoisted(() => ({
  cleanupLegacyKeys: vi.fn(),
}));

vi.mock("../persistence/cleanupLegacyKeys.js", () => ({
  cleanupLegacyKeys: mocks.cleanupLegacyKeys,
}));

describe("useAppGlobalEffects", () => {
  beforeEach(() => {
    mocks.cleanupLegacyKeys.mockReset();
  });

  it("runs legacy key cleanup on mount", () => {
    renderHook(() => useAppGlobalEffects());

    expect(mocks.cleanupLegacyKeys).toHaveBeenCalledTimes(1);
  });

  it("suppresses the native context menu while mounted", () => {
    const { unmount } = renderHook(() => useAppGlobalEffects());

    const suppressed = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    window.dispatchEvent(suppressed);
    expect(suppressed.defaultPrevented).toBe(true);

    unmount();
    const restored = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    window.dispatchEvent(restored);
    expect(restored.defaultPrevented).toBe(false);
  });
});
