import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import { cn } from "@/lib/utils";
import { SPECTRUM_VIEW_OPTIONS, spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  normalizePanelControls,
} from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { DIALOGUE_VAD_ENGINE_OPTIONS } from "@/lib/dialogueVadEngines.js";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { Switch } from "@/components/ui/switch";
import { openExternalUrl } from "@/ipc/openExternal.js";

const SETTINGS_SELECT_TRIGGER_CLASS =
  "h-6 max-w-none rounded-md border px-2 py-0 text-xs text-popover-foreground shadow-none outline-none transition-colors focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";

const SETTINGS_VALUE_IDLE_CLASS =
  "border-transparent bg-transparent hover:border-border hover:bg-secondary/85 hover:text-foreground";

const SETTINGS_VALUE_OPEN_CLASS = "border-primary/55 bg-secondary/30 text-foreground";

const SETTINGS_DETAIL_SURFACE_CLASS =
  "mt-1 overflow-hidden rounded-md bg-popover/35 p-0.5 ring-1 ring-border/30";

const SETTINGS_CHOICE_ROW_CLASS =
  "flex w-full items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-left text-xs text-popover-foreground outline-none transition-colors hover:bg-secondary/50 hover:text-foreground";

const SETTINGS_CHOICE_CHECK_CLASS = "flex size-3 items-center justify-center text-primary/85";

const SETTINGS_SWITCH_CLASS =
  "h-4 w-7 border border-border/40 bg-secondary/85 transition-colors hover:border-border/70 hover:bg-muted-foreground/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:border-primary data-[state=checked]:hover:bg-primary data-[state=unchecked]:bg-secondary/85 data-[state=unchecked]:hover:bg-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";

const SETTINGS_SWITCH_THUMB_CLASS =
  "size-3 bg-popover-foreground/80 shadow-none data-[state=checked]:translate-x-3 data-[state=checked]:bg-background/95 data-[state=unchecked]:translate-x-0";

function SettingsGroup({ children }) {
  return <div className="flex w-max max-w-[calc(100vw-2rem)] flex-col gap-0.5">{children}</div>;
}

function SettingsRow({ label, tooltip, children }) {
  return (
    <div className="grid min-h-6 grid-cols-[max-content_minmax(0,1fr)] items-start gap-2 rounded-md px-1.5 py-0.5 text-xs">
      <span className="group relative flex h-6 items-center whitespace-nowrap font-medium text-muted-foreground">
        {label}
        {tooltip ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden w-48 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-normal leading-snug text-popover-foreground shadow-sm group-hover:block"
          >
            {tooltip}
          </span>
        ) : null}
      </span>
      <div className="flex min-h-6 min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

function settingsValueClass(open, className) {
  return cn(
    SETTINGS_SELECT_TRIGGER_CLASS,
    open ? SETTINGS_VALUE_OPEN_CLASS : SETTINGS_VALUE_IDLE_CLASS,
    className
  );
}

function SettingsSwitch(props) {
  return (
    <Switch
      className={SETTINGS_SWITCH_CLASS}
      thumbClassName={SETTINGS_SWITCH_THUMB_CLASS}
      {...props}
    />
  );
}

function SettingsSlider({ ariaLabel, value, min, max, step, formatValue, onCommit }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const displayValue = formatValue(draftValue);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const commit = (nextValue) => {
    onCommit(Number(nextValue));
  };

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
        onChange={(event) => setDraftValue(Number(event.target.value))}
        onPointerUp={(event) => commit(event.currentTarget.value)}
        onKeyUp={(event) => commit(event.currentTarget.value)}
        className="h-6 w-16 accent-primary opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      />
      {tooltipOpen ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full right-0 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-1.5 py-0.5 font-[family-name:var(--ui-font-mono)] text-[10px] tabular-nums text-popover-foreground shadow-sm"
        >
          {displayValue}
        </span>
      ) : null}
    </div>
  );
}

function SettingsRangeInput({
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
    "h-6 rounded-md border border-border/60 bg-transparent px-1 py-0 text-right font-[family-name:var(--ui-font-mono)] text-[11px] tabular-nums text-popover-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring";

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

function SettingsLufsInput({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (draft.trim() === "") {
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= -70 && parsed <= 0) {
      onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        aria-label="Loudness reference"
        type="number"
        min={-70}
        max={0}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-6 w-14 rounded-md border border-transparent bg-transparent px-1.5 py-0 text-center font-[family-name:var(--ui-font-mono)] text-xs tabular-nums text-popover-foreground transition-colors hover:border-border hover:bg-secondary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <span className="text-muted-foreground/60 shrink-0">LUFS</span>
    </div>
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
      <DisclosureIcon aria-hidden="true" className="size-3 text-muted-foreground/60" />
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
        {checked ? <Check aria-hidden="true" className="size-3" /> : null}
      </span>
      {children}
    </button>
  );
}

function SettingsSelect({ label, ariaLabel, options, value, onChange, open, onOpenChange }) {
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
          {options.map((opt) => (
            <SettingsOptionRow
              key={opt.key ?? opt.id}
              role="option"
              aria-selected={(opt.key ?? opt.id) === value}
              checked={(opt.key ?? opt.id) === value}
              onClick={() => {
                onChange(opt.key ?? opt.id);
                onOpenChange(false);
              }}
            >
              {typeof opt.renderLabel === "function" ? opt.renderLabel(opt) : opt.label}
            </SettingsOptionRow>
          ))}
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
                  {checked ? <Check aria-hidden="true" className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <button
                  type="button"
                  aria-label={`Open ${option.label} official link`}
                  className="rounded-sm p-0.5 text-muted-foreground/60 transition-colors hover:bg-secondary/60 hover:text-foreground"
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
                  <ExternalLink aria-hidden="true" className="size-3" />
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
      className="group flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-secondary/35"
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

function SortableStatsList({
  label,
  options,
  orderedIds,
  selectedIds,
  onToggle,
  onReorder,
  onReset,
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
              className="w-auto rounded-sm px-2 py-0.5 text-left text-[11px] text-muted-foreground/70 outline-none transition-colors hover:bg-secondary/35 hover:text-foreground"
            >
              Reset
            </button>
          )}
        />
      </div>
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

function toggleId(ids, id) {
  if (ids.includes(id)) {
    return ids.filter((currentId) => currentId !== id);
  }
  return [...ids, id];
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
  spectrumPeakHold = false,
  onSpectrumPeakHoldToggle,
  panelControls,
  onPanelControlsChange,
}) {
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [levelMeterModeOpen, setLevelMeterModeOpen] = useState(false);
  const [spectrumChannelOpen, setSpectrumChannelOpen] = useState(false);
  const [spectrumViewOpen, setSpectrumViewOpen] = useState(false);
  const [vectorscopeChannelOpen, setVectorscopeChannelOpen] = useState(false);
  const [vadOpen, setVadOpen] = useState(false);

  if (activeTab === "levelMeter") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    const selectedMode =
      LEVEL_METER_MODE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.levelMeterMode
      ) ?? LEVEL_METER_MODE_OPTIONS[0];
    const showValueMarkerToggle =
      selectedMode.id === "momentary" || selectedMode.id === "shortTerm";
    const isPeakMode = selectedMode.id === "peak";
    const levelMeterYMinDb = isPeakMode
      ? normalizedPanelControls.levelMeterYMinDb
      : normalizedPanelControls.loudnessYMinDb;
    const levelMeterYMaxDb = isPeakMode
      ? normalizedPanelControls.levelMeterYMaxDb
      : normalizedPanelControls.loudnessYMaxDb;

    return (
      <SettingsGroup title="Level Meter">
        <SettingsRow label="Mode">
          <SettingsSelect
            label={selectedMode.label}
            ariaLabel="level meter mode"
            options={LEVEL_METER_MODE_OPTIONS}
            value={selectedMode.id}
            open={levelMeterModeOpen}
            onOpenChange={setLevelMeterModeOpen}
            onChange={(levelMeterMode) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  levelMeterMode,
                })
              );
            }}
          />
        </SettingsRow>
        {showValueMarkerToggle ? (
          <>
            <SettingsRow label="Playback max">
              <SettingsSwitch
                aria-label="level meter playback max"
                checked={normalizedPanelControls.levelMeterPlaybackMax}
                onCheckedChange={(checked) => {
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      levelMeterPlaybackMax: checked,
                    })
                  );
                }}
              />
            </SettingsRow>
            <SettingsRow label="Floating value">
              <SettingsSwitch
                aria-label="level meter floating value"
                checked={normalizedPanelControls.levelMeterValueMarker}
                onCheckedChange={(checked) => {
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      levelMeterValueMarker: checked,
                    })
                  );
                }}
              />
            </SettingsRow>
          </>
        ) : null}
        {isPeakMode ? (
          <SettingsRow label="TP Max">
            <SettingsSwitch
              aria-label="level meter TP Max"
              checked={normalizedPanelControls.levelMeterTpMaxMarker}
              onCheckedChange={(checked) => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    levelMeterTpMaxMarker: checked,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Y range">
          <SettingsRangeInput
            minAriaLabel="level meter y range min"
            maxAriaLabel="level meter y range max"
            minValue={levelMeterYMinDb}
            maxValue={levelMeterYMaxDb}
            onCommit={(newMin, newMax) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  ...(isPeakMode
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

  if (activeTab === "stats") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    const selectedVad =
      DIALOGUE_VAD_ENGINE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.dialogueVadEngine
      ) ?? DIALOGUE_VAD_ENGINE_OPTIONS[0];

    return (
      <SettingsGroup title="Stats">
        <SettingsRow label="Metrics" expanded={metricsOpen}>
          <div className="flex min-w-0 flex-1 flex-col">
            <InlineDetailTrigger
              ariaLabel={metricsOpen ? "Hide metrics" : "Edit metrics"}
              summary={visibleSummary(normalizedPanelControls.statsVisibleIds.length)}
              open={metricsOpen}
              onToggle={() => setMetricsOpen((open) => !open)}
            />
            {metricsOpen ? (
              <div className={SETTINGS_DETAIL_SURFACE_CLASS}>
                <SortableStatsList
                  label="Metrics"
                  options={STATS_OPTIONS}
                  orderedIds={normalizedPanelControls.statsOrder}
                  selectedIds={normalizedPanelControls.statsVisibleIds}
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
              </div>
            ) : null}
          </div>
        </SettingsRow>
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
        <SettingsRow label="Ref">
          <SettingsLufsInput
            value={normalizedPanelControls.loudnessReferenceLufs}
            onCommit={(loudnessReferenceLufs) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  loudnessReferenceLufs,
                })
              );
            }}
          />
        </SettingsRow>
        <SettingsRow label="Layers" expanded={layersOpen}>
          <div className="flex min-w-0 flex-1 flex-col">
            <InlineDetailTrigger
              ariaLabel={layersOpen ? "Hide layers" : "Edit layers"}
              summary={visibleSummary(
                normalizedPanelControls.loudnessHistoryVisibleLayerIds.length
              )}
              open={layersOpen}
              onToggle={() => setLayersOpen((open) => !open)}
            />
            {layersOpen ? (
              <div className={SETTINGS_DETAIL_SURFACE_CLASS}>
                <MultiSelectList
                  label="Layers"
                  options={LOUDNESS_HISTORY_LAYER_OPTIONS}
                  selectedIds={normalizedPanelControls.loudnessHistoryVisibleLayerIds}
                  onToggle={(id) => {
                    onPanelControlsChange(
                      normalizePanelControls({
                        ...normalizedPanelControls,
                        loudnessHistoryVisibleLayerIds: toggleId(
                          normalizedPanelControls.loudnessHistoryVisibleLayerIds,
                          id
                        ),
                      })
                    );
                  }}
                />
              </div>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow label="Y range">
          <SettingsRangeInput
            minAriaLabel="loudness y range min"
            maxAriaLabel="loudness y range max"
            minValue={normalizedPanelControls.loudnessYMinDb}
            maxValue={normalizedPanelControls.loudnessYMaxDb}
            onCommit={(newMin, newMax) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  loudnessYMinDb: newMin,
                  loudnessYMaxDb: newMax,
                })
              );
            }}
          />
        </SettingsRow>
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
    const effectiveSpectrumPeakHold = hasPanelControls
      ? normalizedPanelControls.spectrumPeakHold
      : spectrumPeakHold;
    const effectiveSmoothingPercent = normalizedPanelControls.spectrumSmoothingPercent;
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
    const showPeak = activeTab === "spectrum" && typeof onSpectrumPeakHoldToggle === "function";
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
        {showPeak ? (
          <SettingsRow label="Peak hold">
            <SettingsSwitch
              aria-label="peak hold"
              checked={effectiveSpectrumPeakHold}
              onCheckedChange={(checked) => {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrumPeakHold: checked,
                  })
                );
                onSpectrumPeakHoldToggle?.();
              }}
            />
          </SettingsRow>
        ) : null}
        {showDisplayControls ? (
          <SettingsRow label="Smoothing">
            <SettingsSlider
              ariaLabel="spectrum smoothing"
              min={0}
              max={100}
              step={1}
              value={effectiveSmoothingPercent}
              formatValue={(value) => `${value.toFixed(0)}%`}
              onCommit={(value) => {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrumSmoothingPercent: value,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
        {showDisplayControls ? (
          <SettingsRow label="Tilt">
            <SettingsSlider
              ariaLabel="spectrum tilt"
              min={0}
              max={6}
              step={0.25}
              value={effectiveTiltDbPerOctave}
              formatValue={(value) => `${value.toFixed(2)} dB/oct`}
              onCommit={(value) => {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrumTiltDbPerOctave: value,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
        {showDisplayControls ? (
          <SettingsRow label="X range">
            <SettingsRangeInput
              minAriaLabel="spectrum x range min"
              maxAriaLabel="spectrum x range max"
              minValue={normalizedPanelControls.spectrumXMinFreq}
              maxValue={normalizedPanelControls.spectrumXMaxFreq}
              onCommit={(newMin, newMax) => {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrumXMinFreq: newMin,
                    spectrumXMaxFreq: newMax,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
        {showDisplayControls ? (
          <SettingsRow label="Y range">
            <SettingsRangeInput
              minAriaLabel="spectrum y range min"
              maxAriaLabel="spectrum y range max"
              minValue={effectiveYMinDb}
              maxValue={effectiveYMaxDb}
              onCommit={(newMin, newMax) => {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrumYMinDb: newMin,
                    spectrumYMaxDb: newMax,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
        {showSpectrogramRange ? (
          <SettingsRow label="Y range">
            <SettingsRangeInput
              minAriaLabel="spectrogram y range min"
              maxAriaLabel="spectrogram y range max"
              minValue={normalizedPanelControls.spectrogramYMinFreq}
              maxValue={normalizedPanelControls.spectrogramYMaxFreq}
              onCommit={(newMin, newMax) => {
                onPanelControlsChange?.(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    spectrogramYMinFreq: newMin,
                    spectrogramYMaxFreq: newMax,
                  })
                );
              }}
            />
          </SettingsRow>
        ) : null}
      </SettingsGroup>
    );
  }

  if (!Number.isFinite(channelCount) || channelCount <= 2) return null;

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

    return (
      <SettingsGroup title="Vectorscope">
        <SettingsRow label="Channel pair">
          <SettingsSelect
            label={selectedLabel}
            ariaLabel="vectorscope channel"
            options={vectorscopeOptions}
            value={selectedOption.key}
            open={vectorscopeChannelOpen}
            onOpenChange={setVectorscopeChannelOpen}
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
      </SettingsGroup>
    );
  }

  return null;
}
