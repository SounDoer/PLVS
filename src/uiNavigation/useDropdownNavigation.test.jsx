/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { useState } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider, useUiNavigation, useUiSurface } from "./UiNavigationContext.jsx";
import { useDropdownNavigation } from "./useDropdownNavigation.js";
import { UiSurfaceScope } from "./uiSurfaceScope.jsx";

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

  it("closes with its parent while the parent's content is still animating out", async () => {
    /** @type {any} */
    const seen = {};
    function Dropdown() {
      seen.dropdown = useDropdownNavigation("panel-control:spectrum:spectrumMaxMode");
      return null;
    }
    function Menu() {
      const [open, setOpen] = useState(true);
      seen.navigation = useUiNavigation();
      useUiSurface({
        active: open,
        kind: "panelSettings",
        origin: "navigable",
        dismissible: true,
        supportedActions: ["close"],
        target: { panelId: "spectrum" },
        onClose: () => setOpen(false),
      });
      // Like a closing popover, the content stays mounted; only the scope reports the close.
      return (
        <UiSurfaceScope active={open}>
          <Dropdown />
        </UiSurfaceScope>
      );
    }
    render(<Menu />, { wrapper });

    /** @type {any} */
    let pending;
    await act(async () => {
      pending = seen.navigation.showDropdown({
        control: "panel-control:spectrum:spectrumMaxMode",
        expectedRevision: 2,
        expectedUiGeneration: seen.navigation.inspectUi().uiGeneration,
      });
      await Promise.resolve();
    });
    await pending;
    const kinds = () => seen.navigation.inspectUi().surfaces.map((surface) => surface.kind);
    expect(kinds()).toEqual(["panelSettings", "dropdown"]);

    const parent = seen.navigation
      .inspectUi()
      .surfaces.find((surface) => surface.kind === "panelSettings");
    await act(async () => {
      pending = seen.navigation.closeSurface({
        surfaceId: parent.surfaceId,
        expectedRevision: 2,
        expectedUiGeneration: seen.navigation.inspectUi().uiGeneration,
      });
      await Promise.resolve();
    });
    await pending;
    expect(seen.dropdown.rootProps.open).toBe(true);
    expect(kinds()).toEqual([]);
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
