import { useState } from "react";

import { normalizePanelControls } from "@/lib/panelControls.js";

import {
  PanelControlRows,
  getSelectedOption,
  stereoMapKeyFromPair,
} from "./PanelSettingsControls.jsx";
import { SettingsGroup, SettingsSelect } from "./SettingsWidgets.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function StereoMapSettings({
  stereoMapPairOptions = [],
  stereoMapPairValueKey = "",
  stereoMapPairDisplayLabel = "",
  onStereoMapPairChange,
  panelControls,
  onPanelControlsChange,
}) {
  const [stereoMapPairOpen, setStereoMapPairOpen] = useState(false);
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);
  const showPair = stereoMapPairOptions.length > 0;
  const effectiveStereoMapPairValueKey =
    stereoMapKeyFromPair(normalizedPanelControls.stereoMapPair) || stereoMapPairValueKey;
  const { matchedOption, selectedOption } = showPair
    ? getSelectedOption(stereoMapPairOptions, effectiveStereoMapPairValueKey)
    : { matchedOption: null, selectedOption: null };
  const pairLabel = matchedOption
    ? selectedOption.label
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
                  const nextPair = { x: opt.x, y: opt.y };
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      stereoMapPair: nextPair,
                    })
                  );
                  onStereoMapPairChange?.(nextPair);
                }
              }}
            />
          ) : null,
        }}
      />
    </SettingsGroup>
  );
}
