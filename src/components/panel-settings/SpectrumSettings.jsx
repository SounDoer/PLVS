import { useState } from "react";

import { SPECTRUM_OCTAVE_SMOOTHING_OPTIONS, normalizePanelControls } from "@/lib/panelControls.js";
import { SPECTRUM_VIEW_OPTIONS, spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";

import { TimeRangeRow } from "./AxisRangeRows.jsx";
import { PanelControlRows } from "./PanelControlRows.jsx";
import { SpectrumDisplaySettingsRows, SpectrumViewChipLabel } from "./PanelSettingsControls.jsx";
import { getSelectedOption, spectrumKeyFromSelection } from "./selectionKeys.js";
import {
  SettingsChoiceSelect,
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
} from "./SettingsWidgets.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function SpectrumSettings({
  activeTab,
  channelCount = 0,
  spectrumOptions = [],
  spectrumValueKey = "",
  spectrumDisplayLabel = "",
  onSpectrumChange,
  spectrumView = "combined",
  spectrumViewLegend = null,
  onSpectrumViewChange,
  spectrumMaxMode = "off",
  onSpectrumMaxModeChange,
  panelControls,
  onPanelControlsChange,
}) {
  const [spectrumChannelOpen, setSpectrumChannelOpen] = useState(false);
  const [spectrumViewOpen, setSpectrumViewOpen] = useState(false);
  const [spectrogramSmoothingOpen, setSpectrogramSmoothingOpen] = useState(false);
  const hasPanelControls = panelControls != null;
  const normalizedPanelControls = normalizePanelControls(panelControls);
  const effectiveSpectrumValueKey =
    (hasPanelControls ? spectrumKeyFromSelection(normalizedPanelControls.spectrumChannel) : "") ||
    spectrumValueKey;
  const effectiveSpectrumView = hasPanelControls
    ? normalizedPanelControls.spectrumView
    : spectrumView;
  const effectiveSpectrumMaxMode = hasPanelControls
    ? normalizedPanelControls.spectrumMaxMode
    : spectrumMaxMode;
  const { matchedOption, selectedOption } = getSelectedOption(
    spectrumOptions,
    effectiveSpectrumValueKey
  );
  const sel = selectedOption?.sel ?? null;
  // The view toggle (M/S, L/R) only makes sense for the overlaid spectrum curve; a spectrogram is
  // a single heatmap and can't overlay, so it stays on the channel selection only.
  const showView =
    activeTab === "spectrum" &&
    spectrumViewApplies(sel) &&
    typeof onSpectrumViewChange === "function";
  const showChannel = channelCount > 2 && spectrumOptions.length > 0;
  const showPeak = activeTab === "spectrum" && typeof onSpectrumMaxModeChange === "function";
  const showDisplayControls =
    activeTab === "spectrum" && hasPanelControls && typeof onPanelControlsChange === "function";
  const showSpectrogramRange =
    activeTab === "spectrogram" && hasPanelControls && typeof onPanelControlsChange === "function";
  if (!showView && !showChannel && !showPeak && !showDisplayControls && !showSpectrogramRange)
    return null;

  return (
    <SettingsGroup>
      {showChannel ? (
        <SettingsRow label="Channel">
          <SettingsSelect
            label={
              hasPanelControls
                ? selectedOption.label
                : matchedOption && spectrumDisplayLabel
                  ? spectrumDisplayLabel
                  : selectedOption.label
            }
            ariaLabel={`${activeTab} channel`}
            options={spectrumOptions}
            value={selectedOption.key}
            open={spectrumChannelOpen}
            onOpenChange={setSpectrumChannelOpen}
            onChange={(key) => {
              const opt = spectrumOptions.find((option) => option.key === key);
              if (opt) {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrumChannel: opt.sel,
                  })
                );
                if (typeof onSpectrumChange === "function") onSpectrumChange(opt.sel);
              }
            }}
          />
        </SettingsRow>
      ) : null}
      {showView ? (
        <SettingsRow label="View">
          <SettingsSelect
            label={
              <SpectrumViewChipLabel
                fallbackLabel={
                  SPECTRUM_VIEW_OPTIONS.find((option) => option.key === effectiveSpectrumView)
                    ?.label ?? "Combined"
                }
                legend={spectrumViewLegend}
              />
            }
            ariaLabel="spectrum view"
            options={SPECTRUM_VIEW_OPTIONS}
            value={effectiveSpectrumView}
            open={spectrumViewOpen}
            onOpenChange={setSpectrumViewOpen}
            onChange={(key) => {
              onPanelControlsChange?.(
                normalizePanelControls({ ...normalizedPanelControls, spectrumView: key })
              );
              onSpectrumViewChange?.(key);
            }}
          />
        </SettingsRow>
      ) : null}
      <SpectrumDisplaySettingsRows
        showPeak={showPeak}
        showDisplay={showDisplayControls}
        maxMode={effectiveSpectrumMaxMode}
        peakLabels={normalizedPanelControls.spectrumPeakLabels}
        speedPercent={normalizedPanelControls.spectrumSpeedPercent}
        octaveSmoothing={normalizedPanelControls.spectrumOctaveSmoothing}
        tiltDbPerOctave={normalizedPanelControls.spectrumTiltDbPerOctave}
        xMinFreq={normalizedPanelControls.spectrumXMinFreq}
        xMaxFreq={normalizedPanelControls.spectrumXMaxFreq}
        yMinDb={normalizedPanelControls.spectrumYMinDb}
        yMaxDb={normalizedPanelControls.spectrumYMaxDb}
        grid={normalizedPanelControls.spectrumGrid}
        onMaxModeChange={(spectrumMaxMode) => {
          onPanelControlsChange?.(
            normalizePanelControls({ ...normalizedPanelControls, spectrumMaxMode })
          );
          onSpectrumMaxModeChange?.(spectrumMaxMode);
        }}
        onPeakLabelsChange={(spectrumPeakLabels) => {
          onPanelControlsChange?.(
            normalizePanelControls({ ...normalizedPanelControls, spectrumPeakLabels })
          );
        }}
        onSpeedChange={(spectrumSpeedPercent) => {
          onPanelControlsChange?.(
            normalizePanelControls({ ...normalizedPanelControls, spectrumSpeedPercent })
          );
        }}
        onOctaveSmoothingChange={(spectrumOctaveSmoothing) => {
          onPanelControlsChange?.(
            normalizePanelControls({ ...normalizedPanelControls, spectrumOctaveSmoothing })
          );
        }}
        onTiltChange={(spectrumTiltDbPerOctave) => {
          onPanelControlsChange?.(
            normalizePanelControls({ ...normalizedPanelControls, spectrumTiltDbPerOctave })
          );
        }}
        onXRangeChange={(spectrumXMinFreq, spectrumXMaxFreq) => {
          onPanelControlsChange?.(
            normalizePanelControls({
              ...normalizedPanelControls,
              spectrumXMinFreq,
              spectrumXMaxFreq,
            })
          );
        }}
        onYRangeChange={(spectrumYMinDb, spectrumYMaxDb) => {
          onPanelControlsChange?.(
            normalizePanelControls({
              ...normalizedPanelControls,
              spectrumYMinDb,
              spectrumYMaxDb,
            })
          );
        }}
        onGridChange={(spectrumGrid) => {
          onPanelControlsChange?.(
            normalizePanelControls({ ...normalizedPanelControls, spectrumGrid })
          );
        }}
      />
      {showSpectrogramRange ? (
        <PanelControlRows
          tab="spectrogram"
          controls={normalizedPanelControls}
          onChange={onPanelControlsChange}
          slots={{
            // Spectrogram has a time axis; Spectrum, which shares this branch, does not.
            historyWindowSec: <TimeRangeRow />,
            spectrumOctaveSmoothing: (
              <SettingsChoiceSelect
                ariaLabel="spectrogram octave smoothing"
                options={SPECTRUM_OCTAVE_SMOOTHING_OPTIONS}
                value={normalizedPanelControls.spectrumOctaveSmoothing}
                open={spectrogramSmoothingOpen}
                onOpenChange={setSpectrogramSmoothingOpen}
                onChange={(spectrumOctaveSmoothing) => {
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      spectrumOctaveSmoothing,
                    })
                  );
                }}
              />
            ),
          }}
        />
      ) : null}
    </SettingsGroup>
  );
}
