import { normalizePanelControls } from "@/lib/panelControls.js";

import { TimeRangeRow } from "./AxisRangeRows.jsx";
import { LoudnessSettingsRows } from "./PanelSettingsControls.jsx";
import { SettingsGroup } from "./SettingsWidgets.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function LoudnessSettings({ panelControls, onPanelControlsChange }) {
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);

  return (
    <SettingsGroup>
      <LoudnessSettingsRows
        visibleLayerIds={normalizedPanelControls.loudnessHistoryVisibleLayerIds}
        grid={normalizedPanelControls.loudnessGrid}
        yMinDb={normalizedPanelControls.loudnessYMinDb}
        yMaxDb={normalizedPanelControls.loudnessYMaxDb}
        onVisibleLayerIdsChange={(loudnessHistoryVisibleLayerIds) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessHistoryVisibleLayerIds,
            })
          );
        }}
        onGridChange={(loudnessGrid) => {
          onPanelControlsChange(
            normalizePanelControls({ ...normalizedPanelControls, loudnessGrid })
          );
        }}
        onYRangeChange={(loudnessYMinDb, loudnessYMaxDb) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessYMinDb,
              loudnessYMaxDb,
            })
          );
        }}
      />
      <TimeRangeRow />
    </SettingsGroup>
  );
}
