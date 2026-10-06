/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { presetsStore, settingsStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { SettingsProvider, useAppSettings } from "./SettingsContext.jsx";

function wrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider>
        <SettingsProvider>{children}</SettingsProvider>
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

describe("SettingsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    presetsStore.reset();
  });

  it("owns the stored view values and writes them through", () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper });

    act(() => result.current.setWindowPinned(true));
    act(() => result.current.setSurfaceOpacity(60));

    expect(result.current.windowPinned).toBe(true);
    expect(result.current.surfaceOpacity).toBe(60);
    expect(settingsStore.read().windowPinned).toBe(true);
  });

  it("hands out one clear ref for the whole session", () => {
    const { result, rerender } = renderHook(() => useAppSettings(), { wrapper });
    const first = result.current.onClearRef;

    expect(first.current).toBeNull();
    rerender();
    expect(result.current.onClearRef).toBe(first);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAppSettings())).toThrow(
      "useAppSettings must be used inside SettingsProvider"
    );
  });
});
