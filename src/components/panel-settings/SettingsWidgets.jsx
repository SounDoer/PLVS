import { RangeInput } from "@/components/ui/range-input.jsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "@/components/ui/controlStyles.js";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/surfaceStyles.js";
import { useHoverTip } from "@/components/HoverTip.jsx";
import { IconAction } from "@/components/ui/icon-action";
import { MenuRow } from "@/components/ui/row";

const SETTINGS_SELECT_TRIGGER_CLASS =
  "h-[var(--ui-control-h)] max-w-none rounded-md border px-2 py-0 text-[length:var(--ui-fs-control)] text-popover-foreground shadow-none outline-none";

const SETTINGS_VALUE_IDLE_CLASS =
  "border-transparent bg-transparent hover:bg-ui-hover hover:text-foreground";

const SETTINGS_VALUE_OPEN_CLASS = "border-border bg-ui-hover text-foreground";

export const SETTINGS_DETAIL_SURFACE_CLASS = cn(
  POPOVER_SURFACE_CLASS,
  "mt-1 max-h-60 min-w-0 max-w-full overflow-y-auto overflow-x-hidden p-1"
);

const SETTINGS_CHOICE_ROW_CLASS =
  "min-h-[var(--ui-control-h)] min-w-0 gap-1 py-0 text-popover-foreground outline-none hover:text-foreground focus-visible:bg-ui-hover focus-visible:text-foreground";

const SETTINGS_CHOICE_CHECK_CLASS = "flex size-3 items-center justify-center text-primary";

const SETTINGS_SWITCH_CLASS = COMPACT_SWITCH_CLASS;

const SETTINGS_SWITCH_THUMB_CLASS = COMPACT_SWITCH_THUMB_CLASS;

export function SettingsGroup({ children }) {
  return <div className="flex w-full min-w-0 max-w-full flex-col gap-0">{children}</div>;
}

// The label tip is portaled rather than absolutely positioned above the label: the settings body
// scrolls, so an in-flow tip on one of the first rows is clipped by that container and reads as
// hidden behind the settings header.
/**
 * @param {{
 *   label: string,
 *   tooltip?: string,
 *   action?: import("react").ReactNode,
 *   controlAction?: import("react").ReactNode,
 *   children: import("react").ReactNode,
 * }} props
 */
export function SettingsRow({ label, tooltip, action, controlAction, children }) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: tooltip,
    side: "top",
    align: "start",
    tipClassName: "w-48 whitespace-normal rounded-md border-border leading-snug",
  });

  return (
    <div className="grid min-h-[var(--ui-shell-h)] grid-cols-[max-content_minmax(0,1fr)] items-start gap-2 rounded-md px-2 text-[length:var(--ui-fs-control)]">
      <span
        ref={anchorRef}
        onMouseEnter={tooltip ? showTip : undefined}
        onMouseLeave={tooltip ? hideTip : undefined}
        className="flex h-[var(--ui-shell-h)] items-center gap-1 whitespace-nowrap font-medium text-muted-foreground"
      >
        {label}
        {action}
        {tipNode}
      </span>
      <div className="flex min-h-[var(--ui-shell-h)] min-w-0 items-center justify-end gap-2">
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
    <IconAction
      aria-label={ariaLabel}
      aria-hidden={atDefault || undefined}
      tabIndex={atDefault ? -1 : 0}
      onClick={onReset}
      className={cn("outline-none", atDefault && "invisible")}
    >
      <RotateCcw className="size-[length:var(--ui-icon-panel-action)]" />
    </IconAction>
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

/**
 * @param {number} min
 * @param {number} max
 */
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

  const handleChange = (/** @type {string} */ nextValue) => {
    const next = Number(nextValue);
    setDraftValue(next);
    if (!commitOnRelease) onCommit(next);
  };

  // Pointer-up covers ordinary dragging; pointer-cancel commits the last native value before an OS
  // interruption ends the gesture. Key-up covers arrow keys, where holding one auto-repeats change
  // events and releases once.
  const releaseHandlers = commitOnRelease
    ? {
        onPointerUp: (event) => commit(event.currentTarget.value),
        onPointerCancel: (event) => commit(event.currentTarget.value),
        onKeyUp: (event) => commit(event.currentTarget.value),
      }
    : null;

  return (
    <div className="flex min-w-0 items-center justify-end">
      <RangeInput
        aria-label={ariaLabel}
        aria-valuetext={displayValue}
        valueLabel={displayValue}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draftValue}
        onChange={(event) => handleChange(event.target.value)}
        {...releaseHandlers}
        className="plvs-range w-16"
        style={{ "--range-pct": `${draftPercent}%` }}
      />
    </div>
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
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    setDraftMin(formatDraftValue(minValue));
    setDraftMax(formatDraftValue(maxValue));
  }, [minValue, maxValue]);

  const commit = (nextMin = draftMin, nextMax = draftMax) => {
    const parsedMin = Number(nextMin);
    const parsedMax = Number(nextMax);
    if (
      !nextMin.trim() ||
      !nextMax.trim() ||
      !Number.isFinite(parsedMin) ||
      !Number.isFinite(parsedMax)
    ) {
      setDraftMin(formatDraftValue(minValue));
      setDraftMax(formatDraftValue(maxValue));
      return;
    }
    onCommit(parsedMin, parsedMax);
  };

  const commitOnEnter = (event) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      skipNextBlurRef.current = true;
      setDraftMin(formatDraftValue(minValue));
      setDraftMax(formatDraftValue(maxValue));
      event.currentTarget.blur();
    }
  };
  const commitOnBlur = () => {
    if (skipNextBlurRef.current) {
      skipNextBlurRef.current = false;
      return;
    }
    commit();
  };
  const minWidthCh = Math.min(7, Math.max(4.5, draftMin.length + 1.5));
  const maxWidthCh = Math.min(7, Math.max(4.5, draftMax.length + 1.5));
  const inputClass =
    "plvs-input h-[var(--ui-control-h)] rounded-md border border-border bg-transparent px-1 py-0 text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-axis)] tabular-nums text-popover-foreground outline-none";

  return (
    <div className="flex min-w-0 items-center gap-0">
      <input
        aria-label={minAriaLabel}
        type="text"
        inputMode="decimal"
        step={step}
        value={draftMin}
        aria-invalid={(draftMin.trim() !== "" && !Number.isFinite(Number(draftMin))) || undefined}
        onChange={(event) => setDraftMin(event.target.value)}
        onBlur={commitOnBlur}
        onKeyDown={commitOnEnter}
        className={inputClass}
        style={{ width: `${minWidthCh}ch` }}
      />
      <span className="text-muted-foreground">-</span>
      <input
        aria-label={maxAriaLabel}
        type="text"
        inputMode="decimal"
        step={step}
        value={draftMax}
        aria-invalid={(draftMax.trim() !== "" && !Number.isFinite(Number(draftMax))) || undefined}
        onChange={(event) => setDraftMax(event.target.value)}
        onBlur={commitOnBlur}
        onKeyDown={commitOnEnter}
        className={inputClass}
        style={{ width: `${maxWidthCh}ch` }}
      />
    </div>
  );
}

/**
 * @param {{
 *   ariaLabel: string,
 *   value: any,
 *   min: number,
 *   max: number,
 *   step?: number,
 *   suffix?: string,
 *   onCommit: (...args: any[]) => any,
 * }} props
 */
export function SettingsNumberInput({ ariaLabel, value, min, max, step = 1, suffix, onCommit }) {
  const formatDraftValue = (nextValue) =>
    Number.isFinite(nextValue) ? String(Math.round(nextValue)) : String(nextValue ?? "");
  const [draft, setDraft] = useState(formatDraftValue(value));
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    setDraft(formatDraftValue(value));
  }, [value]);

  const restore = () => setDraft(formatDraftValue(value));
  const commit = (/** @type {string} */ nextDraft) => {
    const parsed = Number(nextDraft);
    const nextValue = Math.round(parsed / step) * step;
    if (
      !nextDraft.trim() ||
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
        aria-invalid={
          (draft.trim() !== "" &&
            (!Number.isFinite(Number(draft)) || Number(draft) < min || Number(draft) > max)) ||
          undefined
        }
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
            event.stopPropagation();
            skipNextBlurRef.current = true;
            restore();
            event.currentTarget.blur();
          }
        }}
        className="plvs-input h-[var(--ui-control-h)] rounded-md border border-border bg-transparent px-1 py-0 text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-axis)] tabular-nums text-popover-foreground outline-none"
        style={{ width: `${widthCh}ch` }}
      />
      {suffix ? <span className="text-[color:var(--ui-text-annotation)]">{suffix}</span> : null}
    </div>
  );
}

/// Warning and critical for one mode. Each bound is limited by the other, so an out-of-order entry
/// is refused and restored by SettingsNumberInput instead of being silently repaired.
export function SettingsThresholdInputs({ ariaLabel, warning, critical, min, max, onCommit }) {
  return (
    <div className="flex min-w-0 items-center gap-0">
      <SettingsNumberInput
        ariaLabel={`${ariaLabel} warning`}
        value={warning}
        min={min}
        max={critical}
        onCommit={(nextWarning) => onCommit(nextWarning, critical)}
      />
      <span className="text-muted-foreground">/</span>
      <SettingsNumberInput
        ariaLabel={`${ariaLabel} critical`}
        value={critical}
        min={warning}
        max={max}
        suffix="dB"
        onCommit={(nextCritical) => onCommit(warning, nextCritical)}
      />
    </div>
  );
}

/** @param {{ ariaLabel: string, summary: string, open: boolean, onToggle: (...args: any[]) => any, className?: string }} props */
export function InlineDetailTrigger({ ariaLabel, summary, open, onToggle, className }) {
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
      <DisclosureIcon aria-hidden="true" className="size-[1em] text-muted-foreground" />
    </button>
  );
}

/**
 * @param {{
 *   children: import("react").ReactNode,
 *   checked?: boolean,
 *   className?: string,
 *   checkClassName?: string,
 *   role: string,
 *   [key: string]: any,
 * }} props
 */
export function SettingsOptionRow({
  children,
  checked = false,
  className,
  checkClassName,
  role,
  ...props
}) {
  return (
    <MenuRow
      data-settings-option-row
      role={role}
      className={cn(SETTINGS_CHOICE_ROW_CLASS, className)}
      {...props}
    >
      <span data-settings-option-check className={cn(SETTINGS_CHOICE_CHECK_CLASS, checkClassName)}>
        {checked ? <Check aria-hidden="true" className="size-[1em]" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuRow>
  );
}

/**
 * @param {{
 *   label: import("react").ReactNode,
 *   ariaLabel?: string,
 *   options: any[],
 *   value: string,
 *   onChange?: (...args: any[]) => any,
 *   open?: boolean,
 *   onOpenChange?: (...args: any[]) => any,
 * }} props
 */
export function SettingsSelect({ label, ariaLabel, options, value, onChange, open, onOpenChange }) {
  const groups = [];
  for (const option of options) {
    let group = groups.at(-1);
    if (!group || group.label !== option.group) {
      group = { label: option.group, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  }
  return (
    <Select
      value={String(value)}
      open={open}
      onOpenChange={onOpenChange}
      onValueChange={(key) => {
        const option = options.find((item) => String(item.key ?? item.id) === key);
        if (option) onChange(option.key ?? option.id);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        variant="inline"
        className="max-w-none text-popover-foreground hover:text-foreground"
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        data-settings-select-menu
        position="popper"
        align="end"
        aria-label={ariaLabel}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
        variant="inline"
        className="max-h-[min(24rem,var(--radix-select-content-available-height))]"
      >
        {groups.map((group, index) => (
          <SelectGroup key={index}>
            {group.label ? <SelectLabel>{group.label}</SelectLabel> : null}
            {group.options.map((option) => (
              <SelectItem
                key={option.key ?? option.id}
                value={String(option.key ?? option.id)}
                textValue={typeof option.label === "string" ? option.label : undefined}
              >
                {typeof option.renderLabel === "function"
                  ? option.renderLabel(option)
                  : option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SettingsChoiceSelect({ options, value, ...props }) {
  const selectedOption = options.find((option) => option.id === value) ?? options[0];
  return (
    <SettingsSelect
      {...props}
      options={options}
      value={selectedOption.id}
      label={selectedOption.label}
    />
  );
}

/** The closed state of a disclosure that edits a set: how many of its entries are on. */
export function visibleSummary(count) {
  return `${count} visible`;
}

export function MultiSelectList({ label, options, selectedIds, onToggle }) {
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
