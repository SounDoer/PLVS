import { useState } from "react";

import { normalizePanelControls } from "@/lib/panelControls.js";
import { SPECTRUM_VIEW_OPTIONS, spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";

import { TimeRangeRow } from "./AxisRangeRows.jsx";
import { PanelControlRows } from "./PanelControlRows.jsx";
import { getSelectedOption, spectrumKeyFromSelection } from "./selectionKeys.js";
import { SettingsGroup, SettingsSelect } from "./SettingsWidgets.jsx";

function SpectrumViewChipLabel({ fallbackLabel, legend }) {
  if (!legend?.length) return fallbackLabel;

  return (
    <span className="flex items-center gap-1">
      {legend.map((entry) => (
        <span key={entry.token} className="flex items-center gap-1">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor:
                entry.token === "primary"
                  ? "var(--ui-spectrum-primary)"
                  : "var(--ui-spectrum-secondary)",
            }}
          />
          {entry.label}
        </span>
      ))}
    </span>
  );
}

/**
 * The Spectrum and Spectrogram tabs. They share a channel selection and nothing else the table
 * does not already say, so one component supplies the slots for both.
 * @param {import("./types.js").PanelSettingsProps} props
 */
export function SpectrumSettings({
  activeTab,
  channelCount = 0,
  spectrumOptions = [],
  spectrumViewLegend = null,
  panelControls,
  onPanelControlsChange,
}) {
  const [spectrumChannelOpen, setSpectrumChannelOpen] = useState(false);
  const [spectrumViewOpen, setSpectrumViewOpen] = useState(false);
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);
  const { selectedOption } = getSelectedOption(
    spectrumOptions,
    spectrumKeyFromSelection(normalizedPanelControls.spectrumChannel)
  );
  // The view toggle (M/S, L/R) only makes sense for the overlaid spectrum curve; a spectrogram is
  // a single heatmap and can't overlay, which is why only the Spectrum tab has a View row.
  const showView = spectrumViewApplies(selectedOption?.sel ?? null);
  const showChannel = channelCount > 2 && spectrumOptions.length > 0;
  const update = (changes) =>
    onPanelControlsChange(normalizePanelControls({ ...normalizedPanelControls, ...changes }));

  return (
    <SettingsGroup>
      <PanelControlRows
        tab={activeTab}
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          spectrumChannel: showChannel ? (
            <SettingsSelect
              label={selectedOption.label}
              ariaLabel={`${activeTab} channel`}
              options={spectrumOptions}
              value={selectedOption.key}
              open={spectrumChannelOpen}
              onOpenChange={setSpectrumChannelOpen}
              onChange={(key) => {
                const opt = spectrumOptions.find((option) => option.key === key);
                if (opt) update({ spectrumChannel: opt.sel });
              }}
            />
          ) : null,
          spectrumView: showView ? (
            <SettingsSelect
              label={
                <SpectrumViewChipLabel
                  fallbackLabel={
                    SPECTRUM_VIEW_OPTIONS.find(
                      (option) => option.key === normalizedPanelControls.spectrumView
                    )?.label ?? "Combined"
                  }
                  legend={spectrumViewLegend}
                />
              }
              ariaLabel="spectrum view"
              options={SPECTRUM_VIEW_OPTIONS}
              value={normalizedPanelControls.spectrumView}
              open={spectrumViewOpen}
              onOpenChange={setSpectrumViewOpen}
              onChange={(spectrumView) => update({ spectrumView })}
            />
          ) : null,
          // Spectrogram has a time axis; Spectrum, which shares this component, has no such row.
          historyWindowSec: <TimeRangeRow />,
        }}
      />
    </SettingsGroup>
  );
}
