import { useCallback, useState } from "react";
import { useUiNavigationTarget, useUiSurface } from "./UiNavigationContext.jsx";
import { createUiNavigationError } from "./uiNavigationModel.js";

/** The Dock editor view each toolbar menu opens, the same view its Dock toolbar button opens. */
export const DOCK_VIEW_BY_TOOLBAR_MENU = Object.freeze({
  sources: "device",
  "loudness-profile": "loudness-profile",
  panels: "modules",
  views: "views",
  presets: "presets",
  status: "status",
});

export function sourceMixSelectionChoice(mix, selectedSourceId, selectSource, closeMenu) {
  const id = `select:${mix.id}`;
  return {
    id,
    label: mix.name,
    selected: mix.id === selectedSourceId,
    run: async () => {
      if (!(await selectSource?.(mix.id))) {
        throw createUiNavigationError("uiActionUnavailable", { choice: id });
      }
      closeMenu();
    },
  };
}

/**
 * Which toolbar menu is open in the normal window, and the `ui show toolbar-menu` target for both
 * window forms. The state lives above the header because Auto-hide Controls unmounts the header
 * while it is hidden; opening a menu holds it visible exactly as a click does.
 *
 * @param {{
 *   docked: boolean,
 *   settingsOpen: boolean,
 *   sourcesAvailable: boolean,
 *   statusAvailable: boolean,
 *   autoHideControls: boolean,
 *   controlsVisible: boolean,
 *   holdControls: (open: boolean) => void,
 *   refreshSources?: () => unknown,
 *   sourceMixes?: ReturnType<typeof import("../hooks/useSourceMixes.js").useSourceMixes>,
 *   selectedSourceId?: string,
 *   selectSource?: (id: string) => Promise<boolean>,
 *   canResetPanels?: boolean,
 *   canResetWindowView?: boolean,
 *   resetWindowView?: () => Promise<void>,
 *   openDockMenu: (view: string) => Promise<void>,
 * }} options
 */
export function useToolbarMenuNavigation({
  docked,
  settingsOpen,
  sourcesAvailable,
  statusAvailable,
  autoHideControls,
  controlsVisible,
  holdControls,
  refreshSources,
  sourceMixes,
  selectedSourceId,
  selectSource,
  canResetPanels = false,
  canResetWindowView = false,
  resetWindowView,
  openDockMenu,
}) {
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null));
  const [resetMenu, setResetMenu] = useState(/** @type {"panels" | "views" | null} */ (null));
  const setPanelsReset = useCallback((armed) => setResetMenu(armed ? "panels" : null), []);
  const setViewsReset = useCallback((armed) => setResetMenu(armed ? "views" : null), []);
  const panelsReset = {
    armed: openMenu === "panels" && resetMenu === "panels",
    setArmed: setPanelsReset,
  };
  const viewsReset = {
    armed: openMenu === "views" && resetMenu === "views",
    setArmed: setViewsReset,
  };
  const changeMenu = useCallback(
    (/** @type {string} */ menu, /** @type {boolean} */ open) => {
      if (open && menu === "sources") void refreshSources?.();
      setOpenMenu((current) => (open ? menu : current === menu ? null : current));
      setResetMenu((current) => (open || current === menu ? null : current));
      if (autoHideControls) holdControls(open);
    },
    [autoHideControls, holdControls, refreshSources]
  );
  const available = (/** @type {string} */ menu) =>
    menu === "sources" ? sourcesAvailable : menu === "status" ? statusAvailable : true;

  // A menu does not survive the window form or its own control going away.
  const menuGone = openMenu !== null && (docked || !available(openMenu));
  if (menuGone) {
    setOpenMenu(null);
    setResetMenu(null);
  }

  useUiNavigationTarget("toolbarMenu", {
    show: async ({ menu }) => {
      if (!available(menu))
        throw createUiNavigationError("uiTargetNotVisible", { kind: "toolbarMenu", menu });
      if (docked) {
        await openDockMenu(DOCK_VIEW_BY_TOOLBAR_MENU[menu]);
        return;
      }
      if (settingsOpen) throw createUiNavigationError("uiConflict", { kind: "settings" });
      changeMenu(menu, true);
    },
  });
  const mixChoices =
    openMenu === "sources" && sourceMixes?.supported
      ? [
          {
            id: "add-mix",
            label: "Add Mix",
            run: () => {
              sourceMixes.open();
              changeMenu("sources", false);
            },
          },
          ...sourceMixes.list.flatMap((mix) => [
            sourceMixSelectionChoice(mix, selectedSourceId, selectSource, () =>
              changeMenu("sources", false)
            ),
            {
              id: `edit:${mix.id}`,
              label: `Edit ${mix.name}`,
              run: () => {
                sourceMixes.open(mix);
                changeMenu("sources", false);
              },
            },
          ]),
        ]
      : undefined;
  let choices = mixChoices;
  if (openMenu === "panels") {
    choices = [
      {
        id: "reset-layout",
        label: "Reset Layout",
        disabled: !canResetPanels,
        run: () => setPanelsReset(true),
      },
    ];
  }
  if (openMenu === "views") {
    choices = viewsReset.armed
      ? [
          { id: "cancel-reset", label: "Cancel Reset", run: () => setViewsReset(false) },
          {
            id: "confirm-reset",
            label: "Reset View Settings",
            run: () => {
              setViewsReset(false);
              return resetWindowView?.();
            },
          },
        ]
      : [
          {
            id: "reset-view-settings",
            label: "Reset View Settings",
            disabled: !canResetWindowView,
            run: () => setViewsReset(true),
          },
        ];
  }
  useUiSurface({
    active: openMenu !== null && !menuGone && controlsVisible,
    kind: "toolbarMenu",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { menu: openMenu, presentation: "window" },
    onClose: () => changeMenu(openMenu, false),
    choices,
  });

  return { openMenu, changeMenu, panelsReset, viewsReset };
}
