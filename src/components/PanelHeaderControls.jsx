import { Check } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  normalizePanelControls,
} from "@/lib/panelControls.js";

const CHIP_CLASS =
  "h-6 min-w-0 max-w-[6rem] rounded-md border border-border/70 bg-transparent px-2 py-0 text-[11px] text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground focus:ring-0 focus:ring-offset-0";

function ChannelTrigger({ label, ariaLabel }) {
  return (
    <SelectTrigger aria-label={ariaLabel} className={CHIP_CLASS}>
      <SelectValue>{label}</SelectValue>
    </SelectTrigger>
  );
}

function SingleSelectChip({ label, ariaLabel, options, value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <ChannelTrigger label={label} ariaLabel={ariaLabel} />
      <SelectContent align="end" sideOffset={6}>
        {options.map((opt) => (
          <SelectItem key={opt.key} value={opt.key}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

function getSelectedOption(options, valueKey) {
  const matchedOption = options.find((opt) => opt.key === valueKey);
  return {
    matchedOption,
    selectedOption: matchedOption ?? options[0],
  };
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
  panelControls,
  onPanelControlsChange,
}) {
  if (activeTab === "loudnessStats") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <MultiSelectChip
        label="Stats"
        options={LOUDNESS_STATS_OPTIONS}
        selectedIds={normalizedPanelControls.loudnessStatsVisibleIds}
        onToggle={(id) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessStatsVisibleIds: toggleId(
                normalizedPanelControls.loudnessStatsVisibleIds,
                id
              ),
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

  if (!Number.isFinite(channelCount) || channelCount <= 2) return null;

  if (activeTab === "vectorscope" && vectorscopeOptions.length > 0) {
    const { matchedOption, selectedOption } = getSelectedOption(
      vectorscopeOptions,
      vectorscopeValueKey
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
            onVectorscopeChange({ x: opt.x, y: opt.y });
          }
        }}
      />
    );
  }

  if ((activeTab === "spectrum" || activeTab === "spectrogram") && spectrumOptions.length > 0) {
    const { matchedOption, selectedOption } = getSelectedOption(spectrumOptions, spectrumValueKey);
    const selectedLabel =
      matchedOption && spectrumDisplayLabel ? spectrumDisplayLabel : selectedOption.label;

    return (
      <SingleSelectChip
        label={selectedLabel}
        ariaLabel={`${activeTab} channel`}
        options={spectrumOptions}
        value={selectedOption.key}
        onChange={(key) => {
          const opt = spectrumOptions.find((o) => o.key === key);
          if (opt && typeof onSpectrumChange === "function") {
            onSpectrumChange(opt.sel);
          }
        }}
      />
    );
  }

  return null;
}
