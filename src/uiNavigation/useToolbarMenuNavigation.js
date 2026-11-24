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
  openDockMenu,
}) {
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null));
  const changeMenu = useCallback(
    (/** @type {string} */ menu, /** @type {boolean} */ open) => {
      if (open && menu === "sources") void refreshSources?.();
      setOpenMenu((current) => (open ? menu : current === menu ? null : current));
      if (autoHideControls) holdControls(open);
    },
    [autoHideControls, holdControls, refreshSources]
  );
  const available = (/** @type {string} */ menu) =>
    menu === "sources" ? sourcesAvailable : menu === "status" ? statusAvailable : true;

  // A menu does not survive the window form or its own control going away.
  const menuGone = openMenu !== null && (docked || !available(openMenu));
  if (menuGone) setOpenMenu(null);

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
            {
              id: `select:${mix.id}`,
              label: mix.name,
              selected: mix.id === selectedSourceId,
              run: async () => {
                if (!(await selectSource?.(mix.id)))
                  throw createUiNavigationError("uiActionUnavailable", {
                    choice: `select:${mix.id}`,
                  });
                changeMenu("sources", false);
              },
            },
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
  useUiSurface({
    active: openMenu !== null && !menuGone && controlsVisible,
    kind: "toolbarMenu",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { menu: openMenu, presentation: "window" },
    onClose: () => changeMenu(openMenu, false),
    choices: mixChoices,
  });

  return { openMenu, changeMenu };
}
