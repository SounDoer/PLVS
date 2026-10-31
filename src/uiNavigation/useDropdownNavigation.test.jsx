/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider, useUiNavigation } from "./UiNavigationContext.jsx";
import { useDropdownNavigation } from "./useDropdownNavigation.js";

function wrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 2}>{children}</UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

describe("named dropdowns", () => {
  it("names the trigger and opens and closes through the owner's open state", async () => {
    const { result } = renderHook(
      () => ({
        dropdown: useDropdownNavigation("setting:appearance.interfaceSize"),
        navigation: useUiNavigation(),
      }),
      { wrapper }
    );
    expect(result.current.dropdown.triggerProps).toEqual({
      "data-ui-target": "setting:appearance.interfaceSize",
    });

    /** @type {any} */
    let pending;
    await act(async () => {
      pending = result.current.navigation.showDropdown({
        control: "setting:appearance.interfaceSize",
        expectedRevision: 2,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    const shown = await pending;
    expect(result.current.dropdown.rootProps.open).toBe(true);
    expect(shown.surface).toMatchObject({
      kind: "dropdown",
      target: { control: "setting:appearance.interfaceSize" },
    });

    await act(async () => {
      pending = result.current.navigation.closeSurface({
        surfaceId: shown.surface.surfaceId,
        expectedRevision: 2,
        expectedUiGeneration: result.current.navigation.inspectUi().uiGeneration,
      });
      await Promise.resolve();
    });
    await pending;
    expect(result.current.dropdown.rootProps.open).toBe(false);
  });

  it("refuses an unnamed dropdown", async () => {
    const { result } = renderHook(
      () => ({ dropdown: useDropdownNavigation(undefined), navigation: useUiNavigation() }),
      { wrapper }
    );
    expect(result.current.dropdown.triggerProps).toEqual({});
    await expect(
      result.current.navigation.showDropdown({
        control: "setting:missing",
        expectedRevision: 2,
        expectedUiGeneration: 0,
      })
    ).rejects.toMatchObject({ reason: "surfaceUnavailable" });
  });
});
