import { useState } from "react";

import { normalizePanelControls } from "@/lib/panelControls.js";
import { formatVectorscopePairLabel } from "@/math/vectorscopePairMath.js";

import { PanelControlRows } from "./PanelControlRows.jsx";
import { getSelectedOption, stereoMapKeyFromPair, storedChannelLabel } from "./selectionKeys.js";
import { SettingsGroup, SettingsSelect } from "./SettingsWidgets.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function StereoMapSettings({
  channelCount = 0,
  stereoMapPairOptions = [],
  stereoMapPairDisplayLabel = "",
  panelControls,
  onPanelControlsChange,
}) {
  const [stereoMapPairOpen, setStereoMapPairOpen] = useState(false);
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);
  const showPair = stereoMapPairOptions.length > 0;
  const { matchedOption, selectedOption } = showPair
    ? getSelectedOption(
        stereoMapPairOptions,
        stereoMapKeyFromPair(normalizedPanelControls.stereoMapPair)
      )
    : { matchedOption: null, selectedOption: null };
  const pairLabel = matchedOption
    ? selectedOption.label
    : channelCount > 0
      ? storedChannelLabel(
          formatVectorscopePairLabel({
            ...normalizedPanelControls.stereoMapPair,
            channelLabels: [],
          }),
          channelCount
        )
      : stereoMapPairDisplayLabel || selectedOption?.label;

  return (
    <SettingsGroup>
      <PanelControlRows
        tab="stereo-map"
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          stereoMapPair: showPair ? (
            <SettingsSelect
              label={pairLabel}
              ariaLabel="stereo map channel"
              options={stereoMapPairOptions}
              value={selectedOption.key}
              open={stereoMapPairOpen}
              onOpenChange={setStereoMapPairOpen}
              onChange={(key) => {
                const opt = stereoMapPairOptions.find((option) => option.key === key);
                if (opt) {
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      stereoMapPair: { x: opt.x, y: opt.y },
                    })
                  );
                }
              }}
            />
          ) : null,
        }}
      />
    </SettingsGroup>
  );
}
