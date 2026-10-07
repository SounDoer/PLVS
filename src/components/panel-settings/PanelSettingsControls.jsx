import { useState } from "react";
import { GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import {
  GRID_TOOLTIP,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  SPECTRUM_MAX_MODE_OPTIONS,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
  SPECTRUM_TILT_TOOLTIP,
} from "@/lib/panelControls.js";
import { STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { ResetAction } from "@/components/ResetAction.jsx";
import { useLoudnessProfile } from "@/hooks/LoudnessProfileContext.jsx";

import { AxisViewportRangeInput, RangeRowLinkToggle } from "./AxisRangeRows.jsx";
import { toggleId } from "./selectionKeys.js";
import {
  InlineDetailTrigger,
  MultiSelectList,
  SETTINGS_DETAIL_SURFACE_CLASS,
  SettingsChoiceSelect,
  SettingsNumberInput,
  SettingsOptionRow,
  SettingsRangeInput,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from "./SettingsWidgets.jsx";

export function WaveformSettingsRows({
  frequencyColor,
  lowMidSplitHz,
  midHighSplitHz,
  centroid,
  onFrequencyColorChange,
  onLowMidSplitChange,
  onMidHighSplitChange,
  onCentroidChange,
}) {
  return (
    <>
      <SettingsRow label="Frequency Color">
        <SettingsSwitch
          aria-label="waveform frequency color"
          checked={frequencyColor}
          onCheckedChange={onFrequencyColorChange}
        />
      </SettingsRow>
      {frequencyColor ? (
        <>
          <SettingsRow label="Low / Mid Split">
            <SettingsNumberInput
              ariaLabel="waveform low mid split"
              value={lowMidSplitHz}
              min={20}
              max={20000}
              suffix="Hz"
              onCommit={(/** @type {number} */ nextValue) =>
                nextValue < midHighSplitHz ? onLowMidSplitChange(nextValue) : false
              }
            />
          </SettingsRow>
          <SettingsRow label="Mid / High Split">
            <SettingsNumberInput
              ariaLabel="waveform mid high split"
              value={midHighSplitHz}
              min={20}
              max={20000}
              suffix="Hz"
              onCommit={(/** @type {number} */ nextValue) =>
                nextValue > lowMidSplitHz ? onMidHighSplitChange(nextValue) : false
              }
            />
          </SettingsRow>
        </>
      ) : null}
      <SettingsRow label="Centroid">
        <SettingsSwitch
          aria-label="waveform centroid"
          checked={centroid}
          onCheckedChange={onCentroidChange}
        />
      </SettingsRow>
    </>
  );
}

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

function SortableStatRow({ id, label, checked, onToggle }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="group flex min-h-[var(--ui-control-h)] items-center gap-1 rounded-xs px-1 hover:bg-ui-hover"
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="flex cursor-grab touch-none items-center text-muted-foreground group-hover:text-foreground"
      >
        <GripVertical className="size-3.5" />
      </span>
      <SettingsOptionRow
        role="checkbox"
        aria-checked={checked}
        className="min-w-0 flex-1 px-1 hover:bg-transparent"
        checked={checked}
        onClick={() => onToggle(id)}
      >
        {label}
      </SettingsOptionRow>
    </Reorder.Item>
  );
}

export function SortableStatsList({
  label,
  options,
  orderedIds,
  selectedIds,
  onToggle,
  onReorder,
  onReset,
  showReset = true,
}) {
  const labelById = new Map(options.map((option) => [option.id, option.label]));
  return (
    <div className="flex flex-col gap-0">
      <Reorder.Group
        axis="y"
        values={orderedIds}
        onReorder={onReorder}
        role="group"
        aria-label={label}
        className="flex select-none flex-col gap-0"
      >
        {orderedIds.map((id) => (
          <SortableStatRow
            key={id}
            id={id}
            label={labelById.get(id) ?? id}
            checked={selectedIds.includes(id)}
            onToggle={onToggle}
          />
        ))}
      </Reorder.Group>
      <div className="mt-0 flex justify-end border-t border-border pt-0">
        <ResetAction
          label="Reset stats"
          isDefault={!showReset}
          onReset={onReset}
          confirmLabel="Confirm reset stats"
          cancelLabel="Cancel reset stats"
        />
      </div>
    </div>
  );
}

function visibleSummary(count) {
  return `${count} visible`;
}

/**
 * @param {{
 *   visibleIds: any[],
 *   orderedIds: any[],
 *   onToggle: (...args: any[]) => any,
 *   onReorder: (...args: any[]) => any,
 *   onReset?: (...args: any[]) => any,
 *   showReset?: boolean,
 * }} props
 */
export function StatsMetricsSettingsRow({
  visibleIds,
  orderedIds,
  onToggle,
  onReorder,
  onReset,
  showReset = true,
}) {
  const [open, setOpen] = useState(false);

  return (
    <SettingsRow label="Metrics">
      <div className="flex min-w-0 flex-1 flex-col">
        <InlineDetailTrigger
          ariaLabel={open ? "Hide metrics" : "Edit metrics"}
          summary={visibleSummary(visibleIds.length)}
          open={open}
          onToggle={() => setOpen((current) => !current)}
        />
        {open ? (
          <div data-settings-detail-surface className={SETTINGS_DETAIL_SURFACE_CLASS}>
            <SortableStatsList
              label="Metrics"
              options={STATS_OPTIONS}
              orderedIds={orderedIds}
              selectedIds={visibleIds}
              onToggle={onToggle}
              onReorder={onReorder}
              onReset={onReset}
              showReset={showReset}
            />
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}

/// No Ref input: the reference value is owned by the active Loudness Profile, so a second
/// editor here would be a competing writer. The `ref` layer toggle stays.
/**
 * @param {{
 *   showGrid?: boolean,
 *   visibleLayerIds: any[],
 *   grid?: boolean,
 *   yMinDb: number,
 *   yMaxDb: number,
 *   onVisibleLayerIdsChange: (...args: any[]) => any,
 *   onGridChange?: (...args: any[]) => any,
 *   onYRangeChange: (...args: any[]) => any,
 * }} props
 */
export function LoudnessSettingsRows({
  showGrid = true,
  visibleLayerIds,
  grid,
  yMinDb,
  yMaxDb,
  onVisibleLayerIdsChange,
  onGridChange,
  onYRangeChange,
}) {
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
    <>
      <SettingsRow label="Layers">
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
      </SettingsRow>
      {showGrid ? (
        <SettingsRow label="Grid" tooltip={GRID_TOOLTIP}>
          <SettingsSwitch
            aria-label="loudness grid"
            checked={grid}
            onCheckedChange={onGridChange}
          />
        </SettingsRow>
      ) : null}
      <SettingsRow label="Loudness Range">
        <SettingsRangeInput
          minAriaLabel="loudness range min"
          maxAriaLabel="loudness range max"
          minValue={yMinDb}
          maxValue={yMaxDb}
          onCommit={onYRangeChange}
        />
      </SettingsRow>
    </>
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
