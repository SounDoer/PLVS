import { useState } from "react";

import {
  GRID_TOOLTIP,
  SPECTRUM_MAX_MODE_OPTIONS,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
  SPECTRUM_TILT_TOOLTIP,
} from "@/lib/panelControls.js";

import { AxisViewportRangeInput, RangeRowLinkToggle } from "./AxisRangeRows.jsx";
import {
  SettingsChoiceSelect,
  SettingsRangeInput,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from "./SettingsWidgets.jsx";

export function SpectrumViewChipLabel({ fallbackLabel, legend }) {
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
 * @param {{
 *   showPeak?: boolean,
 *   showPeakLabels?: boolean,
 *   showDisplay?: boolean,
 *   showGrid?: boolean,
 *   maxMode: string,
 *   peakLabels?: boolean,
 *   speedPercent: number,
 *   octaveSmoothing: string,
 *   tiltDbPerOctave: number,
 *   xMinFreq: number,
 *   xMaxFreq: number,
 *   yMinDb: number,
 *   yMaxDb: number,
 *   grid?: boolean,
 *   onMaxModeChange: (...args: any[]) => any,
 *   onPeakLabelsChange?: (...args: any[]) => any,
 *   onSpeedChange: (...args: any[]) => any,
 *   onOctaveSmoothingChange: (...args: any[]) => any,
 *   onTiltChange: (...args: any[]) => any,
 *   onXRangeChange: (...args: any[]) => any,
 *   onYRangeChange: (...args: any[]) => any,
 *   onGridChange?: (...args: any[]) => any,
 * }} props
 */
export function SpectrumDisplaySettingsRows({
  showPeak = true,
  showPeakLabels = showPeak,
  showDisplay = true,
  showGrid = true,
  maxMode,
  peakLabels,
  speedPercent,
  octaveSmoothing,
  tiltDbPerOctave,
  xMinFreq,
  xMaxFreq,
  yMinDb,
  yMaxDb,
  grid,
  onMaxModeChange,
  onPeakLabelsChange,
  onSpeedChange,
  onOctaveSmoothingChange,
  onTiltChange,
  onXRangeChange,
  onYRangeChange,
  onGridChange,
}) {
  const [smoothingOpen, setSmoothingOpen] = useState(false);
  const [maxModeOpen, setMaxModeOpen] = useState(false);
  return (
    <>
      {showPeak ? (
        <SettingsRow
          label="Max"
          tooltip="What the filled area shows. Decay holds each band's peak briefly, then lets it fall. Hold keeps the highest level since it was selected — click the edge of the fill to clear it."
        >
          <SettingsSelect
            label={
              (
                SPECTRUM_MAX_MODE_OPTIONS.find((option) => option.id === maxMode) ??
                SPECTRUM_MAX_MODE_OPTIONS[0]
              ).label
            }
            ariaLabel="spectrum max mode"
            options={SPECTRUM_MAX_MODE_OPTIONS}
            value={maxMode}
            open={maxModeOpen}
            onOpenChange={setMaxModeOpen}
            onChange={onMaxModeChange}
          />
        </SettingsRow>
      ) : null}
      {showPeakLabels ? (
        <SettingsRow
          label="Peak Labels"
          tooltip="Names the frequency of the most prominent peaks in the curve, so there is a readout without hovering. Max is the time axis; this is the frequency axis."
        >
          <SettingsSwitch
            aria-label="spectrum peak labels"
            checked={peakLabels}
            onCheckedChange={onPeakLabelsChange}
          />
        </SettingsRow>
      ) : null}
      {showDisplay ? (
        <>
          <SettingsRow label="Speed">
            <SettingsSlider
              ariaLabel="spectrum speed"
              min={0}
              max={100}
              step={1}
              value={speedPercent}
              formatValue={(/** @type {number} */ value) => `${value.toFixed(0)}%`}
              onCommit={onSpeedChange}
              commitOnRelease
            />
          </SettingsRow>
          <SettingsRow label="Tilt" tooltip={SPECTRUM_TILT_TOOLTIP}>
            <SettingsSlider
              ariaLabel="spectrum tilt"
              min={0}
              max={6}
              step={0.25}
              value={tiltDbPerOctave}
              formatValue={(/** @type {number} */ value) => `${value.toFixed(2)} dB/oct`}
              onCommit={onTiltChange}
            />
          </SettingsRow>
          <SettingsRow
            label="Smoothing"
            tooltip="Averages the curve across frequency to show tonal balance instead of individual partials. Speed smooths over time; this smooths over frequency."
          >
            <SettingsChoiceSelect
              ariaLabel="spectrum octave smoothing"
              options={SPECTRUM_OCTAVE_SMOOTHING_OPTIONS}
              value={octaveSmoothing}
              open={smoothingOpen}
              onOpenChange={setSmoothingOpen}
              onChange={onOctaveSmoothingChange}
            />
          </SettingsRow>
          {showGrid ? (
            <SettingsRow label="Grid" tooltip={GRID_TOOLTIP}>
              <SettingsSwitch
                aria-label="spectrum grid"
                checked={grid}
                onCheckedChange={onGridChange}
              />
            </SettingsRow>
          ) : null}
          <SettingsRow
            label="Frequency Range"
            controlAction={
              <RangeRowLinkToggle
                moduleId="spectrum"
                minKey="spectrumXMinFreq"
                label="Frequency Range"
              />
            }
          >
            <AxisViewportRangeInput
              moduleId="spectrum"
              minKey="spectrumXMinFreq"
              minAriaLabel="spectrum frequency range min"
              maxAriaLabel="spectrum frequency range max"
              controls={{ spectrumXMinFreq: xMinFreq, spectrumXMaxFreq: xMaxFreq }}
              onLocalCommit={onXRangeChange}
            />
          </SettingsRow>
          <SettingsRow label="Level Range">
            <SettingsRangeInput
              minAriaLabel="spectrum level range min"
              maxAriaLabel="spectrum level range max"
              minValue={yMinDb}
              maxValue={yMaxDb}
              onCommit={onYRangeChange}
            />
          </SettingsRow>
        </>
      ) : null}
    </>
  );
}
