import { useState } from "react";

import { normalizePanelControls } from "@/lib/panelControls.js";
import { formatVectorscopePairLabel } from "@/math/vectorscopePairMath.js";

import { PanelControlRows } from "./PanelControlRows.jsx";
import { getSelectedOption, storedChannelLabel, vectorscopeKeyFromPair } from "./selectionKeys.js";
import { SettingsGroup, SettingsSelect } from "./SettingsWidgets.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function VectorscopeSettings({
  channelCount = 0,
  vectorscopeOptions = [],
  panelControls,
  onPanelControlsChange,
}) {
  const [vectorscopeChannelOpen, setVectorscopeChannelOpen] = useState(false);
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;
  if (vectorscopeOptions.length === 0) return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);
  const { matchedOption, selectedOption } = getSelectedOption(
    vectorscopeOptions,
    vectorscopeKeyFromPair(normalizedPanelControls.vectorscopePair)
  );
  const pairLabel = matchedOption
    ? selectedOption.label
    : storedChannelLabel(
        formatVectorscopePairLabel({
          ...normalizedPanelControls.vectorscopePair,
          channelLabels: [],
        }),
        channelCount
      );

  return (
    <SettingsGroup>
      <PanelControlRows
        tab="vectorscope"
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          vectorscopePair: (
            <SettingsSelect
              label={pairLabel}
              ariaLabel="vectorscope channel"
              options={vectorscopeOptions}
              value={selectedOption.key}
              open={vectorscopeChannelOpen}
              onOpenChange={setVectorscopeChannelOpen}
              onChange={(key) => {
                const opt = vectorscopeOptions.find((option) => option.key === key);
                if (opt) {
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      vectorscopePair: { x: opt.x, y: opt.y },
                    })
                  );
                }
              }}
            />
          ),
        }}
      />
    </SettingsGroup>
  );
}
