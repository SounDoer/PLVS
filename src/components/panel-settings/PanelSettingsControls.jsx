import { Fragment, useState } from "react";
import { GripVertical, Link2, Link2Off } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import { cn } from "@/lib/utils";
import {
  DEFAULT_PANEL_CONTROLS,
  GRID_TOOLTIP,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  SPECTRUM_MAX_MODE_OPTIONS,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
  SPECTRUM_TILT_TOOLTIP,
  normalizePanelControls,
  panelControlUiRows,
} from "@/lib/panelControls.js";
import { STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { edgesFromViewport, viewportFromEdges } from "@/math/timeViewportEdges.js";
import { useHistoryData } from "@/workspace/AudioDataContext.jsx";
import { useAxisViewport, useAxisViewportLink } from "@/workspace/axisViewportHooks.js";
import { AXIS_VIEWPORTS, axisKindForRangeRow } from "@/workspace/axisViewports.js";
import { HIST_SAMPLE_SEC } from "@/hooks/useLoudnessHistory.js";
import { ResetAction } from "@/components/ResetAction.jsx";
import { useLoudnessProfile } from "@/hooks/LoudnessProfileContext.jsx";
import { HoverTip } from "@/components/HoverTip.jsx";
import { IconAction } from "@/components/ui/icon-action";

import {
  InlineDetailTrigger,
  MultiSelectList,
  SETTINGS_DETAIL_SURFACE_CLASS,
  SettingsChoiceSelect,
  SettingsNumberInput,
  SettingsOptionRow,
  SettingsRangeInput,
  SettingsResetButton,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
  SettingsThresholdInputs,
} from "./SettingsWidgets.jsx";

// The panels with a time axis all edit one shared window today, so this row reads and writes the
// history context directly rather than taking props: whichever panel it is opened from, it is the
// same viewport. Phase 3 of the linked-axis work gives each panel its own, and this is where that
// choice will be revisited.
//
// The two inputs are the values at the ends of the rail, not the window and offset stored
// underneath -- see timeViewportEdges. Rendering nothing without a history context keeps Dock, which
// composes its own settings from the exported rows, and bare test renders unaffected.
/**
 * Rides the `action` slot of the range row it governs, rather than taking a row of its own: the
 * spectrogram carries one of these per axis, in a panel that already has nine rows.
 *
 * Like SettingsResetButton it must hold its width in both states -- the label column is
 * `max-content`, so a control that changed size here would shift the input beside it.
 */
export function AxisLinkToggle({ kindId, label, tipLabel }) {
  const viewport = useAxisViewportLink(kindId);
  if (!viewport.linkable) return null;

  const Icon = viewport.linked ? Link2 : Link2Off;
  const tip = `${viewport.linked ? "Unlink" : "Link"} ${tipLabel}`;
  return (
    <HoverTip tip={tip} side="top">
      <IconAction
        aria-label={label}
        aria-pressed={viewport.linked}
        onClick={() => viewport.setLinked(!viewport.linked)}
        className={cn(
          "flex shrink-0 items-center justify-center outline-none",
          viewport.linked && "text-foreground"
        )}
      >
        <Icon className="size-[length:var(--ui-icon-panel-action)]" />
      </IconAction>
    </HoverTip>
  );
}

/** The toggle for whichever axis kind a range row edits, or nothing if the row edits none. */
export function RangeRowLinkToggle({ moduleId, minKey, label }) {
  const kindId = axisKindForRangeRow(moduleId, minKey);
  if (!kindId) return null;
  return <AxisLinkToggle kindId={kindId} label={`link ${label.toLowerCase()}`} tipLabel={label} />;
}

function AxisViewportRangeInput({
  moduleId,
  minKey,
  minAriaLabel,
  maxAriaLabel,
  controls,
  onLocalCommit,
}) {
  const kindId = axisKindForRangeRow(moduleId, minKey);
  const localKeys = AXIS_VIEWPORTS[kindId].members[moduleId];
  const viewport = useAxisViewport(kindId, localKeys);

  return (
    <SettingsRangeInput
      minAriaLabel={minAriaLabel}
      maxAriaLabel={maxAriaLabel}
      minValue={viewport.linkable ? viewport.min : controls[localKeys.minKey]}
      maxValue={viewport.linkable ? viewport.max : controls[localKeys.maxKey]}
      onCommit={viewport.linkable ? viewport.setRange : onLocalCommit}
    />
  );
}

export function TimeRangeRow() {
  const historyData = useHistoryData();
  if (typeof historyData?.setHistoryWindowSec !== "function") return null;

  const {
    sourceMode,
    totalSamples,
    visibleSamples,
    effectiveOffsetSamples,
    historyMaxWindowSec,
    setHistoryWindowSec,
    setHistoryOffsetSec,
  } = historyData;
  const viewport = {
    sourceMode,
    totalSamples,
    visibleSamples,
    effectiveOffsetSamples,
    sampleSec: HIST_SAMPLE_SEC,
  };
  const { left, right } = edgesFromViewport(viewport);

  return (
    <SettingsRow
      label="Time Range"
      controlAction={<AxisLinkToggle kindId="time" label="link time range" tipLabel="Time Range" />}
    >
      <SettingsRangeInput
        minAriaLabel="time range min"
        maxAriaLabel="time range max"
        minValue={left}
        maxValue={right}
        onCommit={(nextLeft, nextRight) => {
          const next = viewportFromEdges({
            left: nextLeft,
            right: nextRight,
            ...viewport,
            maxWindowSec: historyMaxWindowSec,
          });
          setHistoryWindowSec(next.windowSec);
          setHistoryOffsetSec(next.offsetSec);
        }}
      />
    </SettingsRow>
  );
}

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

export function getSelectedOption(options, valueKey) {
  const matchedOption = options.find((opt) => opt.key === valueKey);
  return {
    matchedOption,
    selectedOption: matchedOption ?? options[0],
  };
}

export function spectrumKeyFromSelection(sel) {
  if (!sel) return "";
  return sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
}

export function vectorscopeKeyFromPair(pair) {
  return pair ? `${pair.x}-${pair.y}` : "";
}

export function stereoMapKeyFromPair(pair) {
  return pair ? `${pair.x}-${pair.y}` : "";
}

export function toggleId(ids, id) {
  if (ids.includes(id)) {
    return ids.filter((currentId) => currentId !== id);
  }
  return [...ids, id];
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

/** Widgets the table declares but does not draw: the settings surface passes them in `slots`. */
const SLOT_WIDGETS = new Set(["custom", "customRow"]);

/**
 * Renders the rows one tab owns straight from the control table: the row carries its label,
 * tooltip, widget and visibility rule, and the value and its repair rule come from the same row.
 * Adding a control to the table is what puts it on screen.
 *
 * One `openKey` for the whole group rather than a piece of state per select: only one popover can
 * be open at a time anyway, and a per-row flag would have to be declared next to the widget, which
 * is exactly the second list this is removing.
 * @param {{ tab: string, controls: import("../../workspace/types.js").PanelControls, onChange: (...args: any[]) => any, slots?: Record<string, import("react").ReactNode> }} props
 */
export function PanelControlRows({ tab, controls, onChange, slots = {} }) {
  const [openKey, setOpenKey] = useState(null);
  const commit = (changes) => onChange(normalizePanelControls({ ...controls, ...changes }));

  return panelControlUiRows(tab)
    .filter((row) => !row.ui.showWhen || row.ui.showWhen(controls))
    .filter((row) => !SLOT_WIDGETS.has(row.ui.widget) || slots[row.key ?? row.minKey])
    .map((row) => {
      const { ui } = row;
      const rowKey = row.key ?? row.minKey;
      // `custom` fills in the control of a row the table labels; `customRow` hands over the row
      // itself, for the ones that carry their own label, link toggle or visibility rule.
      if (ui.widget === "customRow") return <Fragment key={rowKey}>{slots[rowKey]}</Fragment>;
      if (ui.widget === "custom") {
        return (
          <SettingsRow key={rowKey} label={ui.label} tooltip={ui.tooltip}>
            {slots[rowKey]}
          </SettingsRow>
        );
      }
      const action = ui.resettable ? (
        <SettingsResetButton
          ariaLabel={`reset ${ui.ariaLabel}`}
          atDefault={controls[row.key] === DEFAULT_PANEL_CONTROLS[row.key]}
          onReset={() => commit({ [row.key]: DEFAULT_PANEL_CONTROLS[row.key] })}
        />
      ) : null;
      const controlAction = ui.resettable ? null : (
        <RangeRowLinkToggle moduleId={tab} minKey={row.minKey} label={ui.label} />
      );

      return (
        <SettingsRow
          key={rowKey}
          label={ui.label}
          tooltip={ui.tooltip}
          action={action}
          controlAction={controlAction}
        >
          {renderPanelControlWidget(row, tab, controls, commit, openKey, setOpenKey)}
        </SettingsRow>
      );
    });
}

function renderPanelControlWidget(row, tab, controls, commit, openKey, setOpenKey) {
  const { ui } = row;
  const rowKey = row.key ?? row.minKey;
  const open = openKey === rowKey;
  const onOpenChange = (next) => setOpenKey(next ? rowKey : null);

  if (ui.widget === "switch") {
    return (
      <SettingsSwitch
        aria-label={ui.ariaLabel}
        checked={controls[row.key]}
        onCheckedChange={(checked) => commit({ [row.key]: checked })}
      />
    );
  }
  if (ui.widget === "select") {
    const selected = ui.options.find((option) => option.id === controls[row.key]) ?? ui.options[0];
    return (
      <SettingsSelect
        label={selected.label}
        ariaLabel={ui.ariaLabel}
        options={ui.options}
        value={selected.id}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(id) => commit({ [row.key]: id })}
      />
    );
  }
  if (ui.widget === "choiceSelect") {
    return (
      <SettingsChoiceSelect
        ariaLabel={ui.ariaLabel}
        options={ui.options}
        value={controls[row.key]}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(id) => commit({ [row.key]: id })}
      />
    );
  }
  if (ui.widget === "slider") {
    return (
      <SettingsSlider
        ariaLabel={ui.ariaLabel}
        min={ui.min ?? row.min}
        max={ui.max ?? row.max}
        step={ui.step}
        value={controls[row.key]}
        formatValue={ui.format}
        onCommit={(value) => commit({ [row.key]: value })}
        commitOnRelease={ui.commitOnRelease === true}
      />
    );
  }
  if (ui.widget === "rangeMin") {
    return (
      <SettingsRangeInput
        minAriaLabel={`${ui.ariaLabel} min`}
        maxAriaLabel={`${ui.ariaLabel} max`}
        minValue={controls[row.key]}
        maxValue={ui.fixedMax}
        onCommit={(newMin) => commit({ [row.key]: newMin })}
      />
    );
  }
  if (ui.widget === "thresholds") {
    return (
      <SettingsThresholdInputs
        ariaLabel={ui.ariaLabel}
        warning={controls[row.minKey]}
        critical={controls[row.maxKey]}
        min={row.absMin}
        max={row.absMax}
        onCommit={(warning, critical) => commit({ [row.minKey]: warning, [row.maxKey]: critical })}
      />
    );
  }
  if (axisKindForRangeRow(tab, row.minKey)) {
    return (
      <AxisViewportRangeInput
        moduleId={tab}
        minKey={row.minKey}
        minAriaLabel={`${ui.ariaLabel} min`}
        maxAriaLabel={`${ui.ariaLabel} max`}
        controls={controls}
        onLocalCommit={(newMin, newMax) => commit({ [row.minKey]: newMin, [row.maxKey]: newMax })}
      />
    );
  }
  return (
    <SettingsRangeInput
      minAriaLabel={`${ui.ariaLabel} min`}
      maxAriaLabel={`${ui.ariaLabel} max`}
      minValue={controls[row.minKey]}
      maxValue={controls[row.maxKey]}
      onCommit={(newMin, newMax) => commit({ [row.minKey]: newMin, [row.maxKey]: newMax })}
    />
  );
}
