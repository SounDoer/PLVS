import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GripVertical,
  Link2,
  Link2Off,
  RotateCcw,
} from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import { cn } from "@/lib/utils";
import { SPECTRUM_VIEW_OPTIONS, spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";
import {
  DEFAULT_PANEL_CONTROLS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  SPECTRUM_MAX_MODE_OPTIONS,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
  VECTORSCOPE_MODE_OPTIONS,
  normalizePanelControls,
  panelControlUiRows,
} from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { edgesFromViewport, viewportFromEdges } from "@/math/timeViewportEdges.js";
import { useHistoryData } from "@/workspace/AudioDataContext.jsx";
import { useAxisViewport, useAxisViewportLink } from "@/workspace/axisViewportHooks.js";
import { AXIS_VIEWPORTS, axisKindForRangeRow } from "@/workspace/axisViewports.js";
import { HIST_SAMPLE_SEC } from "@/hooks/useLoudnessHistory.js";
import { DIALOGUE_VAD_ENGINE_OPTIONS } from "@/lib/dialogueVadEngines.js";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { Switch } from "@/components/ui/switch";
import { openExternalUrl } from "@/ipc/openExternal.js";
import { useLoudnessProfile } from "@/hooks/LoudnessProfileContext.jsx";
import { HoverTip } from "@/components/HoverTip.jsx";

const SETTINGS_SELECT_TRIGGER_CLASS =
  "h-6 max-w-none rounded-md border px-2 py-0 text-[length:var(--ui-fs-control)] text-popover-foreground shadow-none outline-none transition-colors";

const SETTINGS_VALUE_IDLE_CLASS =
  "border-transparent bg-transparent hover:border-border hover:bg-muted/50 hover:text-foreground";

const SETTINGS_VALUE_OPEN_CLASS = "border-primary/55 bg-secondary/30 text-foreground";

const SETTINGS_DETAIL_SURFACE_CLASS =
  "mt-1 max-h-60 min-w-0 max-w-full overflow-y-auto overflow-x-hidden rounded-md bg-popover/35 p-0.5 ring-1 ring-border/30";

const SETTINGS_CHOICE_ROW_CLASS =
  "flex w-full min-w-0 items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-left text-[length:var(--ui-fs-control)] text-popover-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground";

const SETTINGS_CHOICE_CHECK_CLASS = "flex size-3 items-center justify-center text-primary/85";

const SETTINGS_SWITCH_CLASS =
  "h-4 w-7 border border-border/40 bg-secondary/85 transition-colors hover:border-border/70 hover:bg-muted-foreground/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:border-primary data-[state=checked]:hover:bg-primary data-[state=unchecked]:bg-secondary/85 data-[state=unchecked]:hover:bg-muted-foreground/30";

const SETTINGS_SWITCH_THUMB_CLASS =
  "size-3 bg-popover-foreground/80 shadow-none data-[state=checked]:translate-x-3 data-[state=checked]:bg-background/95 data-[state=unchecked]:translate-x-0";

export function SettingsGroup({ children }) {
  return <div className="flex w-full min-w-0 max-w-full flex-col gap-0.5">{children}</div>;
}

export function SettingsRow({ label, tooltip, action, controlAction, children }) {
  return (
    <div className="grid min-h-6 grid-cols-[max-content_minmax(0,1fr)] items-start gap-2 rounded-md px-1.5 py-0.5 text-[length:var(--ui-fs-control)]">
      <span className="group relative flex h-6 items-center gap-1 whitespace-nowrap font-medium text-muted-foreground">
        {label}
        {action}
        {tooltip ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden w-48 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-[length:var(--ui-fs-axis)] font-normal leading-snug text-popover-foreground shadow-sm group-hover:block"
          >
            {tooltip}
          </span>
        ) : null}
      </span>
      <div className="flex min-h-6 min-w-0 items-center justify-end gap-2">
        {controlAction}
        {children}
      </div>
    </div>
  );
}

// Rendered invisible rather than omitted while the value sits at its default. The label column is
// `max-content`, so a button that comes and goes resizes it and shifts the control beside it — the
// jump would land exactly as the slider leaves its default. `invisible` keeps the width and still
// takes the control out of the accessibility tree.
export function SettingsResetButton({ ariaLabel, atDefault, onReset }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-hidden={atDefault || undefined}
      tabIndex={atDefault ? -1 : 0}
      onClick={onReset}
      className={cn(
        "rounded-xs text-muted-foreground/70 outline-none transition-colors hover:text-foreground",
        atDefault && "invisible"
      )}
    >
      <RotateCcw className="size-[length:var(--ui-icon-panel-action)]" />
    </button>
  );
}

function settingsValueClass(open, className) {
  return cn(
    SETTINGS_SELECT_TRIGGER_CLASS,
    open ? SETTINGS_VALUE_OPEN_CLASS : SETTINGS_VALUE_IDLE_CLASS,
    className
  );
}

export function SettingsSwitch(props) {
  return (
    <Switch
      className={SETTINGS_SWITCH_CLASS}
      thumbClassName={SETTINGS_SWITCH_THUMB_CLASS}
      {...props}
    />
  );
}

function rangePercent(value, min, max) {
  const span = max - min;
  if (!Number.isFinite(value) || !Number.isFinite(span) || span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - min) / span) * 100));
}

export function SettingsSlider({
  ariaLabel,
  value,
  min,
  max,
  step,
  formatValue,
  onCommit,
  commitOnRelease = false,
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const displayValue = formatValue(draftValue);
  const draftPercent = rangePercent(draftValue, min, max);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  // Commit on every change rather than on release, so the chart tracks the thumb. A range input
  // fires change for each value including the final one, so there is nothing left to commit on
  // pointer-up. Every other drag gesture in the app (chart pan, axis rails, 3D rotation) already
  // commits per pointer move; the sliders were the odd ones out.
  //
  // `commitOnRelease` is the exception, and it is not a matter of taste. A few control values are
  // part of an analysis request key (`spectrumRequestKeyFromControls` and friends), and the visual
  // history is stored one slab per key. Committing those per pointer move mints a key for every
  // intermediate value a drag passes through, and FrameIntake keeps a slab for every key it has
  // ever seen -- measured at roughly 750 MB stranded by a single two-second drag at a four-hour
  // retention. The four gestures compared above are all key-neutral, which is why they can afford
  // to commit continuously and these cannot.
  const commit = (nextValue) => {
    const next = Number(nextValue);
    setDraftValue(next);
    onCommit(next);
  };

  const handleChange = (nextValue) => {
    const next = Number(nextValue);
    setDraftValue(next);
    if (!commitOnRelease) onCommit(next);
  };

  // Pointer-up covers dragging; key-up covers arrow keys, where holding one auto-repeats change
  // events and releases once.
  const releaseHandlers = commitOnRelease
    ? {
        onPointerUp: (event) => commit(event.currentTarget.value),
        onKeyUp: (event) => commit(event.currentTarget.value),
      }
    : null;

  return (
    <div className="relative flex min-w-0 items-center justify-end">
      <input
        aria-label={ariaLabel}
        aria-valuetext={displayValue}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draftValue}
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        onFocus={() => setTooltipOpen(true)}
        onBlur={() => setTooltipOpen(false)}
        onChange={(event) => handleChange(event.target.value)}
        {...releaseHandlers}
        className="plvs-range w-16 opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        style={{ "--range-pct": `${draftPercent}%` }}
      />
      {tooltipOpen ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full right-0 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-1.5 py-0.5 font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-caption)] tabular-nums text-popover-foreground shadow-sm"
        >
          {displayValue}
        </span>
      ) : null}
    </div>
  );
}

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
      <button
        type="button"
        aria-label={label}
        aria-pressed={viewport.linked}
        onClick={() => viewport.setLinked(!viewport.linked)}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xs outline-none transition-colors",
          viewport.linked ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground"
        )}
      >
        <Icon className="size-[length:var(--ui-icon-panel-action)]" />
      </button>
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

export function SettingsRangeInput({
  minAriaLabel,
  maxAriaLabel,
  minValue,
  maxValue,
  step = 1,
  onCommit,
}) {
  const formatDraftValue = (value) =>
    Number.isFinite(value) ? String(Math.round(value)) : String(value ?? "");
  const [draftMin, setDraftMin] = useState(formatDraftValue(minValue));
  const [draftMax, setDraftMax] = useState(formatDraftValue(maxValue));

  useEffect(() => {
    setDraftMin(formatDraftValue(minValue));
    setDraftMax(formatDraftValue(maxValue));
  }, [minValue, maxValue]);

  const commit = (nextMin = draftMin, nextMax = draftMax) => {
    const parsedMin = Number(nextMin);
    const parsedMax = Number(nextMax);
    if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
      setDraftMin(formatDraftValue(minValue));
      setDraftMax(formatDraftValue(maxValue));
      return;
    }
    onCommit(parsedMin, parsedMax);
  };

  const commitOnEnter = (event) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };
  const minWidthCh = Math.min(7, Math.max(4.5, draftMin.length + 1.5));
  const maxWidthCh = Math.min(7, Math.max(4.5, draftMax.length + 1.5));
  const inputClass =
    "h-6 rounded-md border border-border/60 bg-transparent px-1 py-0 text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-axis)] tabular-nums text-popover-foreground outline-none transition-colors";

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <input
        aria-label={minAriaLabel}
        type="text"
        inputMode="decimal"
        step={step}
        value={draftMin}
        onChange={(event) => setDraftMin(event.target.value)}
        onBlur={() => commit()}
        onKeyDown={commitOnEnter}
        className={inputClass}
        style={{ width: `${minWidthCh}ch` }}
      />
      <span className="text-muted-foreground/60">-</span>
      <input
        aria-label={maxAriaLabel}
        type="text"
        inputMode="decimal"
        step={step}
        value={draftMax}
        onChange={(event) => setDraftMax(event.target.value)}
        onBlur={() => commit()}
        onKeyDown={commitOnEnter}
        className={inputClass}
        style={{ width: `${maxWidthCh}ch` }}
      />
    </div>
  );
}

export function SettingsNumberInput({ ariaLabel, value, min, max, step = 1, suffix, onCommit }) {
  const formatDraftValue = (nextValue) =>
    Number.isFinite(nextValue) ? String(Math.round(nextValue)) : String(nextValue ?? "");
  const [draft, setDraft] = useState(formatDraftValue(value));
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    setDraft(formatDraftValue(value));
  }, [value]);

  const restore = () => setDraft(formatDraftValue(value));
  const commit = (nextDraft) => {
    const parsed = Number(nextDraft);
    const nextValue = Math.round(parsed / step) * step;
    if (
      !Number.isFinite(parsed) ||
      !Number.isFinite(nextValue) ||
      nextValue < min ||
      nextValue > max ||
      onCommit(nextValue) === false
    ) {
      restore();
      return;
    }
    setDraft(formatDraftValue(nextValue));
  };
  const widthCh = Math.min(8, Math.max(4.5, draft.length + 1.5));

  return (
    <div className="flex min-w-0 items-center gap-1">
      <input
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (skipNextBlurRef.current) {
            skipNextBlurRef.current = false;
            return;
          }
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            skipNextBlurRef.current = true;
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            skipNextBlurRef.current = true;
            restore();
            event.currentTarget.blur();
          }
        }}
        className="h-6 rounded-md border border-border/60 bg-transparent px-1 py-0 text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-axis)] tabular-nums text-popover-foreground outline-none transition-colors"
        style={{ width: `${widthCh}ch` }}
      />
      {suffix ? <span className="text-muted-foreground/60">{suffix}</span> : null}
    </div>
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
              onCommit={(nextValue) =>
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
              onCommit={(nextValue) =>
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

function InlineDetailTrigger({ ariaLabel, summary, open, onToggle, className }) {
  const DisclosureIcon = open ? ChevronUp : ChevronDown;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        settingsValueClass(open),
        "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-left",
        className
      )}
    >
      <span className="min-w-0 truncate">{summary}</span>
      <DisclosureIcon aria-hidden="true" className="size-[1em] text-muted-foreground/60" />
    </button>
  );
}

function SettingsOptionRow({
  children,
  checked = false,
  className,
  checkClassName,
  role,
  ...props
}) {
  return (
    <button
      type="button"
      data-settings-option-row
      role={role}
      className={cn(SETTINGS_CHOICE_ROW_CLASS, className)}
      {...props}
    >
      <span data-settings-option-check className={cn(SETTINGS_CHOICE_CHECK_CLASS, checkClassName)}>
        {checked ? <Check aria-hidden="true" className="size-[1em]" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function SettingsSelect({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  open,
  onOpenChange,
  collapsedGroups = [],
}) {
  const [expandedGroups, setExpandedGroups] = useState({});
  const collapsedGroupSet = new Set(collapsedGroups);

  return (
    <div className="flex min-w-0 flex-col items-end">
      <InlineDetailTrigger
        ariaLabel={ariaLabel}
        summary={label}
        open={open}
        onToggle={() => onOpenChange(!open)}
        className="w-auto grid-cols-[auto_auto] gap-1.5 justify-self-end"
      />
      {open ? (
        <div role="listbox" aria-label={ariaLabel} className={SETTINGS_DETAIL_SURFACE_CLASS}>
          {options.map((opt, index) => {
            const optionKey = opt.key ?? opt.id;
            const previousGroup = index > 0 ? options[index - 1]?.group : null;
            const showGroup = opt.group && opt.group !== previousGroup;
            const groupCollapsed =
              opt.group && collapsedGroupSet.has(opt.group) && expandedGroups[opt.group] !== true;
            return (
              <div key={optionKey}>
                {showGroup ? (
                  collapsedGroupSet.has(opt.group) ? (
                    <button
                      type="button"
                      aria-expanded={!groupCollapsed}
                      onClick={() =>
                        setExpandedGroups((current) => ({
                          ...current,
                          [opt.group]: current[opt.group] !== true,
                        }))
                      }
                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xs px-2 pb-0.5 pt-1 text-left text-[length:var(--ui-fs-caption)] font-semibold uppercase tracking-wide text-muted-foreground/60 outline-none transition-colors hover:bg-muted/50 hover:text-muted-foreground"
                    >
                      <span className="min-w-0 truncate">{opt.group}</span>
                      {groupCollapsed ? (
                        <ChevronDown aria-hidden="true" className="size-[1em] shrink-0" />
                      ) : (
                        <ChevronUp aria-hidden="true" className="size-[1em] shrink-0" />
                      )}
                    </button>
                  ) : (
                    <div className="min-w-0 truncate px-2 pb-0.5 pt-1 text-[length:var(--ui-fs-caption)] font-semibold uppercase tracking-wide text-muted-foreground/60">
                      {opt.group}
                    </div>
                  )
                ) : null}
                {groupCollapsed ? null : (
                  <SettingsOptionRow
                    role="option"
                    aria-selected={optionKey === value}
                    checked={optionKey === value}
                    onClick={() => {
                      onChange(optionKey);
                      onOpenChange(false);
                    }}
                  >
                    {typeof opt.renderLabel === "function" ? opt.renderLabel(opt) : opt.label}
                  </SettingsOptionRow>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/// A plain label-only choice list. `SettingsVadSelect` carries an external-link button per row,
/// which nothing else needs.
function SettingsChoiceSelect({ ariaLabel, options, value, onChange, open, onOpenChange }) {
  const selectedOption = options.find((option) => option.id === value) ?? options[0];
  return (
    <div className="flex min-w-0 flex-col items-end">
      <InlineDetailTrigger
        ariaLabel={ariaLabel}
        summary={selectedOption.label}
        open={open}
        onToggle={() => onOpenChange(!open)}
        className="w-auto grid-cols-[auto_auto] gap-1.5 justify-self-end"
      />
      {open ? (
        <div role="listbox" aria-label={ariaLabel} className={SETTINGS_DETAIL_SURFACE_CLASS}>
          {options.map((option) => {
            const checked = option.id === value;
            return (
              <div
                key={option.id}
                role="option"
                aria-selected={checked}
                tabIndex={0}
                data-settings-option-row
                className={cn(SETTINGS_CHOICE_ROW_CLASS, "cursor-default")}
                onClick={() => {
                  onChange(option.id);
                  onOpenChange(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onChange(option.id);
                    onOpenChange(false);
                  }
                }}
              >
                <span data-settings-option-check className={cn(SETTINGS_CHOICE_CHECK_CLASS)}>
                  {checked ? <Check aria-hidden="true" className="size-[1em]" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SettingsVadSelect({ selectedOption, options, value, onChange, open, onOpenChange }) {
  return (
    <div className="flex min-w-0 flex-col items-end">
      <InlineDetailTrigger
        ariaLabel="dialogue vad"
        summary={selectedOption.label}
        open={open}
        onToggle={() => onOpenChange(!open)}
        className="w-auto grid-cols-[auto_auto] gap-1.5 justify-self-end"
      />
      {open ? (
        <div role="listbox" aria-label="dialogue vad" className={SETTINGS_DETAIL_SURFACE_CLASS}>
          {options.map((option) => {
            const checked = option.id === value;
            return (
              <div
                key={option.id}
                role="option"
                aria-selected={checked}
                tabIndex={0}
                data-settings-option-row
                className={cn(SETTINGS_CHOICE_ROW_CLASS, "cursor-default")}
                onClick={() => {
                  onChange(option.id);
                  onOpenChange(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onChange(option.id);
                    onOpenChange(false);
                  }
                }}
              >
                <span data-settings-option-check className={cn(SETTINGS_CHOICE_CHECK_CLASS)}>
                  {checked ? <Check aria-hidden="true" className="size-[1em]" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <button
                  type="button"
                  aria-label={`Open ${option.label} official link`}
                  className="rounded-xs p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openExternalUrl(option.url);
                  }}
                >
                  <ExternalLink aria-hidden="true" className="size-[1em]" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SpectrumViewChipLabel({ fallbackLabel, legend }) {
  if (!legend?.length) return fallbackLabel;

  return (
    <span className="flex items-center gap-1.5">
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
      className="group flex items-center gap-1 rounded-xs px-1 py-0.5 hover:bg-muted/50"
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="flex cursor-grab touch-none items-center text-muted-foreground/25 transition-opacity group-hover:text-muted-foreground/70"
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
    <div className="flex flex-col gap-0.5">
      <Reorder.Group
        axis="y"
        values={orderedIds}
        onReorder={onReorder}
        role="group"
        aria-label={label}
        className="flex select-none flex-col gap-0.5"
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
      {showReset ? (
        <div className="mt-0.5 border-t border-border/30 pt-0.5">
          <InlineConfirm
            onConfirm={onReset}
            confirmLabel="Confirm reset stats"
            cancelLabel="Cancel reset stats"
            trigger={(arm) => (
              <button
                type="button"
                aria-label="Reset stats"
                onClick={arm}
                className="w-auto rounded-xs px-2 py-0.5 text-left text-[length:var(--ui-fs-axis)] text-muted-foreground/70 outline-none transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                Reset
              </button>
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

function MultiSelectList({ label, options, selectedIds, onToggle }) {
  return (
    <div role="group" aria-label={label}>
      {options.map((option) => {
        const checked = selectedIds.includes(option.id);

        return (
          <SettingsOptionRow
            key={option.id}
            role="checkbox"
            aria-checked={checked}
            checked={checked}
            onClick={() => onToggle(option.id)}
          >
            {option.label}
          </SettingsOptionRow>
        );
      })}
    </div>
  );
}

function visibleSummary(count) {
  return `${count} visible`;
}

function getSelectedOption(options, valueKey) {
  const matchedOption = options.find((opt) => opt.key === valueKey);
  return {
    matchedOption,
    selectedOption: matchedOption ?? options[0],
  };
}

function spectrumKeyFromSelection(sel) {
  if (!sel) return "";
  return sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
}

function vectorscopeKeyFromPair(pair) {
  return pair ? `${pair.x}-${pair.y}` : "";
}

function stereoMapKeyFromPair(pair) {
  return pair ? `${pair.x}-${pair.y}` : "";
}

function toggleId(ids, id) {
  if (ids.includes(id)) {
    return ids.filter((currentId) => currentId !== id);
  }
  return [...ids, id];
}

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
          <div className={SETTINGS_DETAIL_SURFACE_CLASS}>
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
export function LoudnessSettingsRows({
  visibleLayerIds,
  yMinDb,
  yMaxDb,
  onVisibleLayerIdsChange,
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
      <SettingsRow label="Layers" expanded={layersOpen}>
        <div className="flex min-w-0 flex-1 flex-col">
          <InlineDetailTrigger
            ariaLabel={layersOpen ? "Hide layers" : "Edit layers"}
            summary={visibleSummary(visibleCount)}
            open={layersOpen}
            onToggle={() => setLayersOpen((open) => !open)}
          />
          {layersOpen ? (
            <div className={SETTINGS_DETAIL_SURFACE_CLASS}>
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

export function SpectrumDisplaySettingsRows({
  showPeak = true,
  showPeakLabels = showPeak,
  showDisplay = true,
  maxMode,
  peakLabels,
  speedPercent,
  octaveSmoothing,
  tiltDbPerOctave,
  xMinFreq,
  xMaxFreq,
  yMinDb,
  yMaxDb,
  onMaxModeChange,
  onPeakLabelsChange,
  onSpeedChange,
  onOctaveSmoothingChange,
  onTiltChange,
  onXRangeChange,
  onYRangeChange,
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
              formatValue={(value) => `${value.toFixed(0)}%`}
              onCommit={onSpeedChange}
              commitOnRelease
            />
          </SettingsRow>
          <SettingsRow
            label="Tilt"
            tooltip="Lifts the curve by this many dB per octave above 1 kHz and drops it by as much below, so material that slopes downward reads level. Display only: it does not change what is measured."
          >
            <SettingsSlider
              ariaLabel="spectrum tilt"
              min={0}
              max={6}
              step={0.25}
              value={tiltDbPerOctave}
              formatValue={(value) => `${value.toFixed(2)} dB/oct`}
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

/**
 * Renders the rows one tab owns straight from the control table: the row carries its label,
 * tooltip, widget and visibility rule, and the value and its repair rule come from the same row.
 * Adding a control to the table is what puts it on screen.
 *
 * One `openKey` for the whole group rather than a piece of state per select: only one popover can
 * be open at a time anyway, and a per-row flag would have to be declared next to the widget, which
 * is exactly the second list this is removing.
 */
function PanelControlRows({ tab, controls, onChange, slots = {} }) {
  const [openKey, setOpenKey] = useState(null);
  const commit = (changes) => onChange(normalizePanelControls({ ...controls, ...changes }));

  return panelControlUiRows(tab)
    .filter((row) => !row.ui.showWhen || row.ui.showWhen(controls))
    .filter((row) => row.ui.widget !== "custom" || slots[row.key])
    .map((row) => {
      const { ui } = row;
      const rowKey = row.key ?? row.minKey;
      if (ui.widget === "custom") {
        return (
          <SettingsRow key={rowKey} label={ui.label} tooltip={ui.tooltip}>
            {slots[row.key]}
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

export function PanelSettingsContent({
  activeTab,
  channelCount = 0,
  vectorscopeOptions = [],
  vectorscopeValueKey = "",
  vectorscopeDisplayLabel = "",
  onVectorscopeChange,
  spectrumOptions = [],
  spectrumValueKey = "",
  spectrumDisplayLabel = "",
  onSpectrumChange,
  spectrumView = "combined",
  spectrumViewLegend = null,
  onSpectrumViewChange,
  spectrumMaxMode = "off",
  onSpectrumMaxModeChange,
  stereoMapPairOptions = [],
  stereoMapPairValueKey = "",
  stereoMapPairDisplayLabel = "",
  onStereoMapPairChange,
  panelControls,
  onPanelControlsChange,
}) {
  const [spectrumChannelOpen, setSpectrumChannelOpen] = useState(false);
  const [spectrumViewOpen, setSpectrumViewOpen] = useState(false);
  const [vectorscopeChannelOpen, setVectorscopeChannelOpen] = useState(false);
  const [vectorscopeModeOpen, setVectorscopeModeOpen] = useState(false);
  const [stereoMapPairOpen, setStereoMapPairOpen] = useState(false);
  const [spectrogramSmoothingOpen, setSpectrogramSmoothingOpen] = useState(false);
  const [vadOpen, setVadOpen] = useState(false);

  if (activeTab === "levelMeter") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    // Peak and RMS both measure level and share one stored range; Momentary and Short-term
    // measure loudness and share the other. Which pair the row reads and which pair it writes
    // must be the same question, and it is the same question LevelMeterPanel asks.
    const isPeakFamilyMode =
      normalizedPanelControls.levelMeterMode === "peak" ||
      normalizedPanelControls.levelMeterMode === "rms";
    const levelMeterYMinDb = isPeakFamilyMode
      ? normalizedPanelControls.levelMeterYMinDb
      : normalizedPanelControls.loudnessYMinDb;
    const levelMeterYMaxDb = isPeakFamilyMode
      ? normalizedPanelControls.levelMeterYMaxDb
      : normalizedPanelControls.loudnessYMaxDb;

    return (
      <SettingsGroup title="Level Meter">
        <PanelControlRows
          tab="levelMeter"
          controls={normalizedPanelControls}
          onChange={onPanelControlsChange}
        />
        {/* Not a table row: it names one of two stored ranges depending on the mode, so a single
            row would have to carry two pairs of keys. */}
        <SettingsRow label="Level Range">
          <SettingsRangeInput
            minAriaLabel="level meter range min"
            maxAriaLabel="level meter range max"
            minValue={levelMeterYMinDb}
            maxValue={levelMeterYMaxDb}
            onCommit={(newMin, newMax) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  ...(isPeakFamilyMode
                    ? { levelMeterYMinDb: newMin, levelMeterYMaxDb: newMax }
                    : { loudnessYMinDb: newMin, loudnessYMaxDb: newMax }),
                })
              );
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    );
  }

  if (activeTab === "waveform") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    const updateWaveformControls = (changes) => {
      onPanelControlsChange(
        normalizePanelControls({
          ...normalizedPanelControls,
          ...changes,
        })
      );
    };

    return (
      <SettingsGroup>
        <WaveformSettingsRows
          frequencyColor={normalizedPanelControls.waveformFrequencyColor}
          lowMidSplitHz={normalizedPanelControls.waveformLowMidSplitHz}
          midHighSplitHz={normalizedPanelControls.waveformMidHighSplitHz}
          centroid={normalizedPanelControls.waveformCentroid}
          onFrequencyColorChange={(waveformFrequencyColor) =>
            updateWaveformControls({ waveformFrequencyColor })
          }
          onLowMidSplitChange={(waveformLowMidSplitHz) =>
            updateWaveformControls({ waveformLowMidSplitHz })
          }
          onMidHighSplitChange={(waveformMidHighSplitHz) =>
            updateWaveformControls({ waveformMidHighSplitHz })
          }
          onCentroidChange={(waveformCentroid) => updateWaveformControls({ waveformCentroid })}
        />
        <TimeRangeRow />
      </SettingsGroup>
    );
  }

  if (activeTab === "stats") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    const selectedVad =
      DIALOGUE_VAD_ENGINE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.dialogueVadEngine
      ) ?? DIALOGUE_VAD_ENGINE_OPTIONS[0];

    return (
      <SettingsGroup title="Stats">
        <StatsMetricsSettingsRow
          visibleIds={normalizedPanelControls.statsVisibleIds}
          orderedIds={normalizedPanelControls.statsOrder}
          onToggle={(id) => {
            onPanelControlsChange(
              normalizePanelControls({
                ...normalizedPanelControls,
                statsVisibleIds: toggleId(normalizedPanelControls.statsVisibleIds, id),
              })
            );
          }}
          onReorder={(nextOrder) => {
            onPanelControlsChange(
              normalizePanelControls({
                ...normalizedPanelControls,
                statsOrder: nextOrder,
              })
            );
          }}
          onReset={() => {
            onPanelControlsChange(
              normalizePanelControls({
                ...normalizedPanelControls,
                statsOrder: [...STATS_CANONICAL_ORDER],
                statsVisibleIds: [...DEFAULT_PANEL_CONTROLS.statsVisibleIds],
              })
            );
          }}
        />
        <SettingsRow label="VAD" tooltip="Voice activity detector used by dialogue stats.">
          <SettingsVadSelect
            selectedOption={selectedVad}
            options={DIALOGUE_VAD_ENGINE_OPTIONS}
            value={selectedVad.id}
            open={vadOpen}
            onOpenChange={setVadOpen}
            onChange={(dialogueVadEngine) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  dialogueVadEngine,
                })
              );
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    );
  }

  if (activeTab === "loudness") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <SettingsGroup title="Loudness">
        <LoudnessSettingsRows
          visibleLayerIds={normalizedPanelControls.loudnessHistoryVisibleLayerIds}
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

  if (activeTab === "spectrum" || activeTab === "spectrogram") {
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
    const effectiveSpeedPercent = normalizedPanelControls.spectrumSpeedPercent;
    const effectiveTiltDbPerOctave = normalizedPanelControls.spectrumTiltDbPerOctave;
    const effectiveYMaxDb = normalizedPanelControls.spectrumYMaxDb;
    const effectiveYMinDb = normalizedPanelControls.spectrumYMinDb;
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
      activeTab === "spectrogram" &&
      hasPanelControls &&
      typeof onPanelControlsChange === "function";
    if (!showView && !showChannel && !showPeak && !showDisplayControls && !showSpectrogramRange)
      return null;

    return (
      <SettingsGroup title={activeTab === "spectrum" ? "Spectrum" : "Spectrogram"}>
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
                const opt = spectrumOptions.find((o) => o.key === key);
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
          speedPercent={effectiveSpeedPercent}
          octaveSmoothing={normalizedPanelControls.spectrumOctaveSmoothing}
          tiltDbPerOctave={effectiveTiltDbPerOctave}
          xMinFreq={normalizedPanelControls.spectrumXMinFreq}
          xMaxFreq={normalizedPanelControls.spectrumXMaxFreq}
          yMinDb={effectiveYMinDb}
          yMaxDb={effectiveYMaxDb}
          onMaxModeChange={(spectrumMaxMode) => {
            onPanelControlsChange?.(
              normalizePanelControls({ ...normalizedPanelControls, spectrumMaxMode })
            );
            onSpectrumMaxModeChange?.(spectrumMaxMode);
          }}
          onPeakLabelsChange={(checked) => {
            onPanelControlsChange?.(
              normalizePanelControls({
                ...normalizedPanelControls,
                spectrumPeakLabels: checked,
              })
            );
          }}
          onSpeedChange={(value) => {
            onPanelControlsChange?.(
              normalizePanelControls({
                ...normalizedPanelControls,
                spectrumSpeedPercent: value,
              })
            );
          }}
          onOctaveSmoothingChange={(id) => {
            onPanelControlsChange?.(
              normalizePanelControls({
                ...normalizedPanelControls,
                spectrumOctaveSmoothing: id,
              })
            );
          }}
          onTiltChange={(value) => {
            onPanelControlsChange?.(
              normalizePanelControls({
                ...normalizedPanelControls,
                spectrumTiltDbPerOctave: value,
              })
            );
          }}
          onXRangeChange={(newMin, newMax) => {
            onPanelControlsChange?.(
              normalizePanelControls({
                ...normalizedPanelControls,
                spectrumXMinFreq: newMin,
                spectrumXMaxFreq: newMax,
              })
            );
          }}
          onYRangeChange={(newMin, newMax) => {
            onPanelControlsChange?.(
              normalizePanelControls({
                ...normalizedPanelControls,
                spectrumYMinDb: newMin,
                spectrumYMaxDb: newMax,
              })
            );
          }}
        />
        {showSpectrogramRange ? (
          <PanelControlRows
            tab="spectrogram"
            controls={normalizedPanelControls}
            onChange={onPanelControlsChange}
            slots={{
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
        {/* Spectrogram has a time axis; Spectrum, which shares this branch, does not. */}
        {activeTab === "spectrogram" ? <TimeRangeRow /> : null}
      </SettingsGroup>
    );
  }

  if (activeTab === "vectorscope" && vectorscopeOptions.length > 0) {
    const hasPanelControls = panelControls != null;
    const normalizedPanelControls = normalizePanelControls(panelControls);
    const effectiveVectorscopeValueKey =
      (hasPanelControls ? vectorscopeKeyFromPair(normalizedPanelControls.vectorscopePair) : "") ||
      vectorscopeValueKey;
    const { matchedOption, selectedOption } = getSelectedOption(
      vectorscopeOptions,
      effectiveVectorscopeValueKey
    );
    const selectedLabel = hasPanelControls
      ? selectedOption.label
      : matchedOption && vectorscopeDisplayLabel
        ? vectorscopeDisplayLabel
        : selectedOption.label;
    const selectedMode =
      VECTORSCOPE_MODE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.vectorscopeMode
      ) ?? VECTORSCOPE_MODE_OPTIONS[0];

    return (
      <SettingsGroup title="Vectorscope">
        {hasPanelControls && typeof onPanelControlsChange === "function" ? (
          <SettingsRow label="Mode">
            <SettingsSelect
              label={selectedMode.label}
              ariaLabel="vectorscope mode"
              options={VECTORSCOPE_MODE_OPTIONS}
              value={selectedMode.id}
              open={vectorscopeModeOpen}
              onOpenChange={setVectorscopeModeOpen}
              onChange={(vectorscopeMode) => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    vectorscopeMode,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Channel Pair">
          <SettingsSelect
            label={selectedLabel}
            ariaLabel="vectorscope channel"
            options={vectorscopeOptions}
            value={selectedOption.key}
            open={vectorscopeChannelOpen}
            onOpenChange={setVectorscopeChannelOpen}
            collapsedGroups={["All pairs"]}
            onChange={(key) => {
              const opt = vectorscopeOptions.find((o) => o.key === key);
              if (opt && typeof onVectorscopeChange === "function") {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    vectorscopePair: { x: opt.x, y: opt.y },
                  })
                );
                onVectorscopeChange({ x: opt.x, y: opt.y });
              }
            }}
          />
        </SettingsRow>
        {hasPanelControls &&
        typeof onPanelControlsChange === "function" &&
        selectedMode.id === "polarLevel" ? (
          <SettingsRow label="Max Hold">
            <SettingsSwitch
              aria-label="vectorscope polar level max hold"
              checked={normalizedPanelControls.vectorscopePolarLevelMaxHold}
              onCheckedChange={(vectorscopePolarLevelMaxHold) => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    vectorscopePolarLevelMaxHold,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
      </SettingsGroup>
    );
  }

  if (activeTab === "stereo-map") {
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
      <SettingsGroup title="Stereo Map">
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
                collapsedGroups={["All pairs"]}
                onChange={(key) => {
                  const opt = stereoMapPairOptions.find((o) => o.key === key);
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

  return null;
}
