/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider, useUiNavigation } from "./UiNavigationContext.jsx";
import { useToolbarMenuNavigation } from "./useToolbarMenuNavigation.js";

function wrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 5} settlementTimeoutMs={50}>
        {children}
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

function renderMenus(overrides = {}) {
  const options = {
    docked: false,
    settingsOpen: false,
    sourcesAvailable: true,
    statusAvailable: true,
    autoHideControls: true,
    controlsVisible: true,
    holdControls: vi.fn(),
    refreshSources: vi.fn(),
    openDockMenu: vi.fn(async () => {}),
    ...overrides,
  };
  const view = renderHook(
    (props) => ({
      menus: useToolbarMenuNavigation(props),
      navigation: useUiNavigation(),
    }),
    { wrapper, initialProps: options }
  );
  return { ...view, options };
}

/** @returns {Promise<any>} */
async function show(result, menu) {
  /** @type {any} */
  let pending;
  await act(async () => {
    pending = result.current.navigation.showToolbarMenu({
      menu,
      expectedRevision: 5,
      expectedUiGeneration: result.current.navigation.inspectUi().uiGeneration,
    });
    // Callers assert rejections themselves; this only keeps an early one from going unhandled.
    pending.catch(() => {});
    await Promise.resolve();
  });
  return pending;
}

describe("toolbar menu navigation", () => {
  it("opens a menu through the click path and closes it through ui close", async () => {
    const { result, options } = renderMenus();

    const shown = await show(result, "sources");

    expect(shown).toMatchObject({
      action: "ui.show.toolbar-menu",
      surface: { kind: "toolbarMenu", target: { menu: "sources", presentation: "window" } },
    });
    expect(result.current.menus.openMenu).toBe("sources");
    expect(options.refreshSources).toHaveBeenCalledOnce();
    expect(options.holdControls).toHaveBeenLastCalledWith(true);

    let closing;
    await act(async () => {
      closing = result.current.navigation.closeSurface({
        surfaceId: shown.surface.surfaceId,
        expectedRevision: 5,
        expectedUiGeneration: result.current.navigation.inspectUi().uiGeneration,
      });
      await Promise.resolve();
    });
    await expect(closing).resolves.toMatchObject({ action: "ui.close" });
    expect(result.current.menus.openMenu).toBeNull();
    expect(options.holdControls).toHaveBeenLastCalledWith(false);
  });

  it("replaces an open menu, as clicking another toolbar button does", async () => {
    const { result } = renderMenus();
    await show(result, "views");
    const shown = await show(result, "presets");

    expect(shown.surface.target.menu).toBe("presets");
    expect(result.current.navigation.inspectUi().surfaces).toHaveLength(1);
  });

  it("refuses a menu whose control is not shown, or while Settings covers the toolbar", async () => {
    let view = renderMenus({ sourcesAvailable: false, statusAvailable: false });
    await expect(show(view.result, "sources")).rejects.toMatchObject({
      reason: "uiTargetNotVisible",
      details: { menu: "sources" },
    });
    await expect(show(view.result, "status")).rejects.toMatchObject({
      reason: "uiTargetNotVisible",
    });
    view.unmount();

    view = renderMenus({ settingsOpen: true });
    await expect(show(view.result, "panels")).rejects.toMatchObject({ reason: "uiConflict" });
    expect(view.result.current.menus.openMenu).toBeNull();
  });

  it("opens the matching Dock editor view instead of a popover in Dock", async () => {
    const { result, options } = renderMenus({ docked: true });

    await expect(show(result, "panels")).rejects.toMatchObject({ reason: "uiNotSettled" });

    expect(options.openDockMenu).toHaveBeenCalledWith("modules");
    expect(result.current.menus.openMenu).toBeNull();
  });

  it("forgets a menu once its window form ends", async () => {
    const { result, rerender, options } = renderMenus();
    await show(result, "views");

    rerender({ ...options, docked: true });
    await act(async () => {});

    expect(result.current.menus.openMenu).toBeNull();
    expect(result.current.navigation.inspectUi().surfaces).toEqual([]);
  });
});
