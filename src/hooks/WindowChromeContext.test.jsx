/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { WindowChromeProvider, useWindowChrome } from "./WindowChromeContext.jsx";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <UiNavigationProvider>
          <SettingsProvider>
            <SceneGuardProvider>
              <DockProvider>
                <WindowChromeProvider>{children}</WindowChromeProvider>
              </DockProvider>
            </SceneGuardProvider>
          </SettingsProvider>
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("WindowChromeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
    document.documentElement.style.removeProperty("--surface-opacity");
  });

  it("stores a view change through the settings owner", async () => {
    const { result } = renderHook(
      () => ({ chrome: useWindowChrome(), settings: useAppSettings() }),
      { wrapper }
    );

    act(() => result.current.chrome.setPinned(true));
    await waitFor(() => expect(result.current.settings.windowPinned).toBe(true));
    act(() => result.current.chrome.setCompactPanels(true));
    await waitFor(() => expect(result.current.settings.focusView.compactPanels).toBe(true));

    expect(result.current.chrome.view.pinned).toBe(true);
    expect(result.current.chrome.focusViewActive).toBe(true);
  });

  it("publishes surface opacity as a CSS variable", async () => {
    const { result } = renderHook(() => useWindowChrome(), { wrapper });

    act(() => result.current.setSurfaceOpacity(40));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--surface-opacity")).toBe("40%")
    );
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useWindowChrome())).toThrow(
      "useWindowChrome must be used inside WindowChromeProvider"
    );
  });
});
