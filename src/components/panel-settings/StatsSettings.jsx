import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "@/lib/statsCatalog.js";

import { SettingsGroup, StatsMetricsSettingsRow, toggleId } from "./PanelSettingsControls.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function StatsSettings({ panelControls, onPanelControlsChange }) {
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);

  return (
    <SettingsGroup>
      <StatsMetricsSettingsRow
        visibleIds={normalizedPanelControls.statsVisibleIds}
        orderedIds={normalizedPanelControls.statsOrder}
        onToggle={(id) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              statsVisibleIds: toggleId(normalizedPanelControls.statsVisibleIds, id),
            })
          );
        }}
        onReorder={(nextOrder) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              statsOrder: nextOrder,
            })
          );
        }}
        onReset={() => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              statsOrder: [...STATS_CANONICAL_ORDER],
              statsVisibleIds: [...DEFAULT_PANEL_CONTROLS.statsVisibleIds],
            })
          );
        }}
      />
    </SettingsGroup>
  );
}
