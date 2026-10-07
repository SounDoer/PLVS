import { useState } from "react";

import { LOUDNESS_HISTORY_LAYER_OPTIONS, normalizePanelControls } from "@/lib/panelControls.js";
import { useLoudnessProfile } from "@/hooks/LoudnessProfileContext.jsx";

import { TimeRangeRow } from "./AxisRangeRows.jsx";
import { PanelControlRows } from "./PanelControlRows.jsx";
import { toggleId } from "./selectionKeys.js";
import {
  InlineDetailTrigger,
  MultiSelectList,
  SETTINGS_DETAIL_SURFACE_CLASS,
  SettingsGroup,
  visibleSummary,
} from "./SettingsWidgets.jsx";

/// No Ref input: the reference value is owned by the active Loudness Profile, so a second
/// editor here would be a competing writer. The `ref` layer toggle stays.
/**
 * @param {{
 *   visibleLayerIds: any[],
 *   onVisibleLayerIdsChange: (...args: any[]) => any,
 * }} props
 */
export function LoudnessLayersControl({ visibleLayerIds, onVisibleLayerIdsChange }) {
  const [layersOpen, setLayersOpen] = useState(false);
  const { referenceLufs } = useLoudnessProfile();
  // With no active profile there is no reference line, so offering its toggle would be a control
  // that does nothing.
  const layerOptions =
    referenceLufs == null
      ? LOUDNESS_HISTORY_LAYER_OPTIONS.filter((option) => option.id !== "ref")
      : LOUDNESS_HISTORY_LAYER_OPTIONS;
  // Count what the list actually offers, not what the panel still remembers. The `ref` id stays
  // in panel controls through Off so the preference survives, which means the raw length claims
  // a layer the user cannot see or reach.
  const visibleCount = visibleLayerIds.filter((id) =>
    layerOptions.some((option) => option.id === id)
  ).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <InlineDetailTrigger
        ariaLabel={layersOpen ? "Hide layers" : "Edit layers"}
        summary={visibleSummary(visibleCount)}
        open={layersOpen}
        onToggle={() => setLayersOpen((open) => !open)}
      />
      {layersOpen ? (
        <div data-settings-detail-surface className={SETTINGS_DETAIL_SURFACE_CLASS}>
          <MultiSelectList
            label="Layers"
            options={layerOptions}
            selectedIds={visibleLayerIds}
            onToggle={(id) => onVisibleLayerIdsChange(toggleId(visibleLayerIds, id))}
          />
        </div>
      ) : null}
    </div>
  );
}

/** @param {import("./types.js").PanelSettingsProps} props */
export function LoudnessSettings({ panelControls, onPanelControlsChange }) {
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);

  return (
    <SettingsGroup>
      <PanelControlRows
        tab="loudness"
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          loudnessHistoryVisibleLayerIds: (
            <LoudnessLayersControl
              visibleLayerIds={normalizedPanelControls.loudnessHistoryVisibleLayerIds}
              onVisibleLayerIdsChange={(loudnessHistoryVisibleLayerIds) => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    loudnessHistoryVisibleLayerIds,
                  })
                );
              }}
            />
          ),
          historyWindowSec: <TimeRangeRow />,
        }}
      />
    </SettingsGroup>
  );
}
