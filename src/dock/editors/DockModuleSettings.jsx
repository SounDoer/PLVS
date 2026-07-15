import { useState } from "react";
import {
  LoudnessSettingsRows,
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
  SortableStatsList,
} from "../../components/PanelSettingsContent.jsx";
import { STATS_OPTIONS } from "../../lib/statsCatalog.js";
import { DockEditorShell } from "./DockEditorShell.jsx";
import { dockModuleIdForPanelModuleId } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { LEVEL_METER_MODE_OPTIONS } from "../../lib/panelControls.js";

const FIELD_CLASS =
  "h-7 rounded-md border border-border/60 bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SelectField({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <SettingsSelect
      label={selected?.label ?? ""}
      ariaLabel={label}
      options={options.map((option) => ({ key: option.value, label: option.label }))}
      value={value}
      onChange={onChange}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function SliderField({ label, value, min, max, step = 1, suffix = "", onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={label}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="plvs-range w-24"
      />
      <output className="w-12 text-right font-[family-name:var(--ui-font-mono)] text-[10px] tabular-nums text-muted-foreground">
        {value}
        {suffix}
      </output>
    </div>
  );
}

function RangeFields({ label, minValue, maxValue, min, max, step = 1, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <input
        aria-label={`${label} min`}
        type="number"
        value={minValue}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value), maxValue)}
        className={`${FIELD_CLASS} w-20 text-right font-[family-name:var(--ui-font-mono)]`}
      />
      <span className="text-muted-foreground">to</span>
      <input
        aria-label={`${label} max`}
        type="number"
        value={maxValue}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(minValue, Number(event.target.value))}
        className={`${FIELD_CLASS} w-20 text-right font-[family-name:var(--ui-font-mono)]`}
      />
    </div>
  );
}

const CHANNEL_OPTIONS = [
  { value: "pair:0:1", label: "Channels 1 + 2" },
  { value: "pair:2:3", label: "Channels 3 + 4" },
  ...Array.from({ length: 8 }, (_, channel) => ({
    value: `single:${channel}`,
    label: `Channel ${channel + 1}`,
  })),
];

function channelValue(channel) {
  return channel?.type === "single"
    ? `single:${channel.ch}`
    : `pair:${channel?.x ?? 0}:${channel?.y ?? 1}`;
}

function parseChannel(value) {
  const [type, first, second] = value.split(":");
  return type === "single"
    ? { type, ch: Number(first) }
    : { type: "pair", x: Number(first), y: Number(second) };
}

function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

function SettingsBody({ moduleId, controls, onChange }) {
  if (moduleId === "level") {
    const isPeak = controls.mode === "peak";
    const readoutOptions = isPeak
      ? [
          { value: "live", label: "Live" },
          { value: "truePeakMax", label: "TP Max" },
        ]
      : [
          { value: "live", label: "Live" },
          { value: "playbackMax", label: "Playback max" },
        ];
    return (
      <>
        <SettingsRow label="Mode">
          <SelectField
            label="Level mode"
            value={controls.mode}
            options={LEVEL_METER_MODE_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
            onChange={(mode) =>
              onChange({
                ...controls,
                mode,
                readout: "live",
              })
            }
          />
        </SettingsRow>
        <SettingsRow label="Readout">
          <SelectField
            label="Level readout"
            value={controls.readout}
            options={readoutOptions}
            onChange={(readout) => onChange({ ...controls, readout })}
          />
        </SettingsRow>
        <SettingsRow label="Labels">
          <SettingsSwitch
            aria-label="Show Level labels"
            checked={controls.showLabels}
            onCheckedChange={(showLabels) => onChange({ ...controls, showLabels })}
          />
        </SettingsRow>
      </>
    );
  }
  if (moduleId === "loudness") {
    return (
      <LoudnessSettingsRows
        referenceLufs={controls.loudnessReferenceLufs}
        visibleLayerIds={controls.loudnessHistoryVisibleLayerIds}
        yMinDb={controls.loudnessYMinDb}
        yMaxDb={controls.loudnessYMaxDb}
        onReferenceChange={(loudnessReferenceLufs) =>
          onChange({ ...controls, loudnessReferenceLufs })
        }
        onVisibleLayerIdsChange={(loudnessHistoryVisibleLayerIds) =>
          onChange({ ...controls, loudnessHistoryVisibleLayerIds })
        }
        onYRangeChange={(loudnessYMinDb, loudnessYMaxDb) =>
          onChange({ ...controls, loudnessYMinDb, loudnessYMaxDb })
        }
      />
    );
  }
  if (moduleId === "spectrum") {
    return (
      <>
        <SettingsRow label="Channel">
          <SelectField
            label="Spectrum channel"
            value={channelValue(controls.channel)}
            options={CHANNEL_OPTIONS}
            onChange={(value) => onChange({ ...controls, channel: parseChannel(value) })}
          />
        </SettingsRow>
        <SettingsRow label="View">
          <SelectField
            label="Spectrum view"
            value={controls.view}
            options={[
              { value: "combined", label: "Combined" },
              { value: "lr", label: "L / R" },
              { value: "ms", label: "M / S" },
            ]}
            onChange={(view) => onChange({ ...controls, view })}
          />
        </SettingsRow>
        <SettingsRow label="Smoothing">
          <SliderField
            label="Spectrum smoothing"
            value={controls.smoothingPercent}
            min={0}
            max={100}
            suffix="%"
            onChange={(smoothingPercent) => onChange({ ...controls, smoothingPercent })}
          />
        </SettingsRow>
        <SettingsRow label="Tilt">
          <SliderField
            label="Spectrum tilt"
            value={controls.tiltDbPerOctave}
            min={0}
            max={6}
            step={0.5}
            suffix=" dB"
            onChange={(tiltDbPerOctave) => onChange({ ...controls, tiltDbPerOctave })}
          />
        </SettingsRow>
        <SettingsRow label="Peak hold">
          <SettingsSwitch
            aria-label="Spectrum peak hold"
            checked={controls.peakHold}
            onCheckedChange={(peakHold) => onChange({ ...controls, peakHold })}
          />
        </SettingsRow>
        <SettingsRow label="Y range">
          <RangeFields
            label="Spectrum y range"
            minValue={controls.minDb}
            maxValue={controls.maxDb}
            min={-120}
            max={0}
            onChange={(minDb, maxDb) => onChange({ ...controls, minDb, maxDb })}
          />
        </SettingsRow>
      </>
    );
  }
  if (moduleId === "correlation") {
    return (
      <SettingsRow label="Value">
        <SettingsSwitch
          aria-label="Show correlation value"
          checked={controls.showValue}
          onCheckedChange={(showValue) => onChange({ ...controls, showValue })}
        />
      </SettingsRow>
    );
  }
  if (moduleId === "stats") {
    return (
      <div className="flex min-w-0 flex-col gap-1 px-1.5 py-1">
        <div className="flex min-h-6 items-center justify-between gap-2 px-1 text-xs">
          <span className="font-medium text-muted-foreground">Metrics</span>
          <span className="text-[10px] text-muted-foreground/70">
            {controls.statsVisibleIds.length} visible
          </span>
        </div>
        <div className="min-w-0 rounded-md bg-popover/35 p-0.5 ring-1 ring-border/30">
          <SortableStatsList
            label="Metrics"
            options={STATS_OPTIONS}
            orderedIds={controls.statsOrder}
            selectedIds={controls.statsVisibleIds}
            onToggle={(id) =>
              onChange({
                ...controls,
                statsVisibleIds: toggleId(controls.statsVisibleIds, id),
              })
            }
            onReorder={(statsOrder) => onChange({ ...controls, statsOrder })}
            showReset={false}
          />
        </div>
        <p className="px-1 text-[10px] leading-snug text-muted-foreground/65">
          Metrics that do not fit are hidden from the end.
        </p>
      </div>
    );
  }
  if (moduleId === "waveform") {
    return (
      <>
        <SettingsRow label="View">
          <SelectField
            label="Waveform view"
            value={controls.view}
            options={[
              { value: "all", label: "All channels" },
              { value: "single", label: "Single channel" },
            ]}
            onChange={(view) => onChange({ ...controls, view })}
          />
        </SettingsRow>
        {controls.view === "single" ? (
          <SettingsRow label="Channel">
            <SelectField
              label="Waveform channel"
              value={String(controls.channel)}
              options={Array.from({ length: 8 }, (_, channel) => ({
                value: String(channel),
                label: `Channel ${channel + 1}`,
              }))}
              onChange={(channel) => onChange({ ...controls, channel: Number(channel) })}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Window">
          <SliderField
            label="Waveform window"
            value={controls.windowSec}
            min={5}
            max={120}
            suffix=" s"
            onChange={(windowSec) => onChange({ ...controls, windowSec })}
          />
        </SettingsRow>
      </>
    );
  }
  if (moduleId === "spectrogram") {
    return (
      <>
        <SettingsRow label="Channel">
          <SelectField
            label="Spectrogram channel"
            value={channelValue(controls.channel)}
            options={CHANNEL_OPTIONS}
            onChange={(value) => onChange({ ...controls, channel: parseChannel(value) })}
          />
        </SettingsRow>
        <SettingsRow label="Level range">
          <RangeFields
            label="Spectrogram level range"
            minValue={controls.minDb}
            maxValue={controls.maxDb}
            min={-120}
            max={0}
            onChange={(minDb, maxDb) => onChange({ ...controls, minDb, maxDb })}
          />
        </SettingsRow>
        <SettingsRow label="Frequency range">
          <RangeFields
            label="Spectrogram frequency range"
            minValue={controls.minFreq}
            maxValue={controls.maxFreq}
            min={20}
            max={20000}
            onChange={(minFreq, maxFreq) => onChange({ ...controls, minFreq, maxFreq })}
          />
        </SettingsRow>
      </>
    );
  }
  return null;
}

export function DockModuleSettings({ moduleId, title, controls, onChange, onReset, onBack }) {
  const dockModuleId = dockModuleIdForPanelModuleId(moduleId) ?? moduleId;
  const entry = DOCK_MODULE_REGISTRY[dockModuleId];
  if (!entry?.settingsFamily || !controls) return null;
  return (
    <DockEditorShell title={`${title ?? entry.label} settings`} onBack={onBack} onReset={onReset}>
      <SettingsGroup>
        <div className="grid gap-1 p-2">
          <SettingsBody moduleId={dockModuleId} controls={controls} onChange={onChange} />
        </div>
      </SettingsGroup>
    </DockEditorShell>
  );
}
