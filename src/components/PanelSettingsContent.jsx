import { useState } from "react";
import { Check, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import { cn } from "@/lib/utils";
import { SPECTRUM_VIEW_OPTIONS, spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  normalizePanelControls,
} from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { Switch } from "@/components/ui/switch";

const SETTINGS_SELECT_TRIGGER_CLASS =
  "h-7 w-auto max-w-none rounded-md border border-border/70 bg-transparent px-2 py-0 text-xs text-muted-foreground shadow-none outline-none hover:bg-secondary hover:text-foreground focus:border-border/70 focus:ring-0 focus:ring-offset-0 focus-visible:border-border/70 focus-visible:ring-0 focus-visible:ring-offset-0";

function SettingsGroup({ children }) {
  return <div className="flex w-max max-w-[22rem] flex-col gap-1">{children}</div>;
}

function SettingsRow({ label, children }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4 rounded-sm px-1 py-0.5">
      <span className="whitespace-nowrap text-xs font-medium text-popover-foreground">{label}</span>
      <div className="flex min-w-0 shrink-0 items-center">{children}</div>
    </div>
  );
}

function ConfigurePopover({ ariaLabel, children }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-secondary hover:text-foreground"
        >
          Configure
          <ChevronRight aria-hidden="true" className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-auto p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function SettingsSelect({ label, ariaLabel, options, value, onChange, triggerClassName }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            SETTINGS_SELECT_TRIGGER_CLASS,
            "inline-flex items-center justify-between gap-2",
            triggerClassName
          )}
        >
          <span className="min-w-0 whitespace-nowrap">{label}</span>
          <ChevronDown aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-auto p-1">
        {options.map((opt) => (
          <button
            key={opt.key ?? opt.id}
            type="button"
            role="option"
            aria-selected={(opt.key ?? opt.id) === value}
            className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-left text-xs text-popover-foreground outline-none hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onChange(opt.key ?? opt.id);
              setOpen(false);
            }}
          >
            <span className="flex size-4 items-center justify-center">
              {(opt.key ?? opt.id) === value ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : null}
            </span>
            {opt.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
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
        className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-sm px-1 py-1 text-left text-xs text-popover-foreground outline-none hover:text-accent-foreground"
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
    </div>
  );
}

function MultiSelectList({ label, options, selectedIds, onToggle }) {
  return (
    <div role="group" aria-label={label}>
      {options.map((option) => {
        const checked = selectedIds.includes(option.id);

        return (
          <button
            key={option.id}
            type="button"
            role="checkbox"
            aria-checked={checked}
            className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-left text-xs text-popover-foreground outline-none hover:bg-accent hover:text-accent-foreground"
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
  if (activeTab === "levelMeter") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);
    const selectedMode =
      LEVEL_METER_MODE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.levelMeterMode
      ) ?? LEVEL_METER_MODE_OPTIONS[0];

    return (
      <SettingsGroup title="Level Meter">
        <SettingsRow label="Mode">
          <SettingsSelect
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
          />
        </SettingsRow>
      </SettingsGroup>
    );
  }

  if (activeTab === "stats") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <SettingsGroup title="Stats">
        <SettingsRow label="Metrics">
          <ConfigurePopover label="Metrics" ariaLabel="Configure metrics">
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
          </ConfigurePopover>
        </SettingsRow>
      </SettingsGroup>
    );
  }

  if (activeTab === "loudness") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <SettingsGroup title="Loudness">
        <SettingsRow label="Layers">
          <ConfigurePopover label="Layers" ariaLabel="Configure layers">
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
          </ConfigurePopover>
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
            <Switch
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
