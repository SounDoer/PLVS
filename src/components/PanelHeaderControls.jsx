import { Check, GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import { cn } from "@/lib/utils";
import { SPECTRUM_VIEW_OPTIONS, spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  normalizePanelControls,
} from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";

const CHIP_CLASS =
  "h-6 min-w-0 max-w-[6rem] rounded-md border border-border/70 bg-transparent px-2 py-0 text-[11px] text-muted-foreground shadow-none outline-none hover:bg-secondary hover:text-foreground focus:border-border/70 focus:ring-0 focus:ring-offset-0 focus-visible:border-border/70 focus-visible:ring-0 focus-visible:ring-offset-0";

function ChannelTrigger({ label, ariaLabel, triggerClassName }) {
  return (
    <SelectTrigger aria-label={ariaLabel} className={cn(CHIP_CLASS, triggerClassName)}>
      <SelectValue>{label}</SelectValue>
    </SelectTrigger>
  );
}

function SingleSelectChip({ label, ariaLabel, options, value, onChange, triggerClassName }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <ChannelTrigger label={label} ariaLabel={ariaLabel} triggerClassName={triggerClassName} />
      <SelectContent align="end" sideOffset={6}>
        {options.map((opt) => (
          <SelectItem key={opt.key ?? opt.id} value={opt.key ?? opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
      className="flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent/40"
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="flex cursor-grab touch-none items-center text-muted-foreground"
      >
        <GripVertical className="size-3.5" />
      </span>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-sm px-1 py-1 text-left text-sm text-popover-foreground outline-none hover:text-accent-foreground"
        onClick={() => onToggle(id)}
      >
        <span className="flex size-4 items-center justify-center">
          {checked ? <Check aria-hidden="true" className="size-4" /> : null}
        </span>
        {label}
      </button>
    </Reorder.Item>
  );
}

function SortableStatsChip({
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
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={CHIP_CLASS}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto min-w-[8rem] p-1">
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
        <div className="mt-1">
          <InlineConfirm
            onConfirm={onReset}
            confirmLabel="Confirm reset stats"
            cancelLabel="Cancel reset stats"
            trigger={(arm) => (
              <button
                type="button"
                aria-label="Reset stats"
                onClick={arm}
                className="w-full rounded-sm px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
              >
                Reset
              </button>
            )}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectChip({ label, options, selectedIds, onToggle }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={CHIP_CLASS}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto min-w-[8rem] p-1">
        <div role="group" aria-label={label}>
          {options.map((option) => {
            const checked = selectedIds.includes(option.id);

            return (
              <button
                key={option.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-left text-sm text-popover-foreground outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => onToggle(option.id)}
              >
                <span className="flex size-4 items-center justify-center">
                  {checked ? <Check aria-hidden="true" className="size-4" /> : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ToggleChip({ label, ariaLabel, pressed, onToggle }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(CHIP_CLASS, "w-auto", pressed && "bg-secondary text-foreground")}
    >
      {label}
    </button>
  );
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

export function PanelHeaderControls({
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
  if (activeTab === "peak") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    const selectedMode =
      LEVEL_METER_MODE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.levelMeterMode
      ) ?? LEVEL_METER_MODE_OPTIONS[0];

    return (
      <SingleSelectChip
        label={selectedMode.label}
        ariaLabel="level meter mode"
        options={LEVEL_METER_MODE_OPTIONS}
        value={selectedMode.id}
        onChange={(levelMeterMode) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              levelMeterMode,
            })
          );
        }}
        triggerClassName="w-auto"
      />
    );
  }

  if (activeTab === "stats") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <SortableStatsChip
        label="Stats"
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
    );
  }

  if (activeTab === "loudness") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <MultiSelectChip
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
    if (!showView && !showChannel && !showPeak) return null;

    return (
      <div className="flex items-center gap-0.5">
        {showChannel ? (
          <SingleSelectChip
            label={
              matchedOption && spectrumDisplayLabel ? spectrumDisplayLabel : selectedOption.label
            }
            ariaLabel={`${activeTab} channel`}
            options={spectrumOptions}
            value={selectedOption.key}
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
            triggerClassName="w-auto"
          />
        ) : null}
        {showView ? (
          <SingleSelectChip
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
            onChange={(key) => {
              onPanelControlsChange?.(
                normalizePanelControls({ ...normalizedPanelControls, spectrumView: key })
              );
              onSpectrumViewChange?.(key);
            }}
            triggerClassName="w-auto max-w-none"
          />
        ) : null}
        {showPeak ? (
          <ToggleChip
            label="Peak"
            ariaLabel="peak hold"
            pressed={effectiveSpectrumPeakHold}
            onToggle={() => {
              onPanelControlsChange?.(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  spectrumPeakHold: !effectiveSpectrumPeakHold,
                })
              );
              onSpectrumPeakHoldToggle?.();
            }}
          />
        ) : null}
      </div>
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
    const selectedLabel =
      matchedOption && vectorscopeDisplayLabel ? vectorscopeDisplayLabel : selectedOption.label;

    return (
      <SingleSelectChip
        label={selectedLabel}
        ariaLabel="vectorscope channel"
        options={vectorscopeOptions}
        value={selectedOption.key}
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
    );
  }

  return null;
}
