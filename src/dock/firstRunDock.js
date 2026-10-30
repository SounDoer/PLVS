import { DEFAULT_DOCK_PANEL_SIZES, normalizeDockLayout } from "./dockLayout.js";
import {
  firstRunDockControlsByModuleId,
  normalizeDockControlsByPanelId,
} from "./dockModuleControls.js";
import { normalizeDockPanelSizes } from "./dockPanelSizing.js";

/// The first-run strip: tuned modules, widths and controls. Only a store with no Dock yet and
/// Reset Layout use it — every other path (a stored layout, or a modules-only legacy/preset
/// object with no panelsById) keeps responsive sizing and the module defaults. The homepage
/// renderer draws the same strip, so this stays free of persistence and React.
export function firstRunDockState() {
  const base = normalizeDockLayout(undefined);
  const layout = {
    ...base,
    panelSizesById: normalizeDockPanelSizes(base.panelsById, DEFAULT_DOCK_PANEL_SIZES),
  };
  return {
    layout,
    controlsByPanelId: normalizeDockControlsByPanelId(
      layout.panelsById,
      undefined,
      firstRunDockControlsByModuleId()
    ),
  };
}
