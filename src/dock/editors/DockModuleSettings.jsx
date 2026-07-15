import { useState } from "react";
import {
  LoudnessSettingsRows,
  SettingsRangeInput,
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
  SpectrumDisplaySettingsRows,
  StatsMetricsSettingsRow,
} from "../../components/PanelSettingsContent.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";
import { dockModuleIdForPanelModuleId } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { LEVEL_METER_MODE_OPTIONS } from "../../lib/panelControls.js";

function SelectField({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <SettingsSelect
      label={selected?.label ?? ""}
      ariaLabel={label}
      options={options.map((option) => ({
        key: option.value,
        label: option.label,
        group: option.group,
      }))}
      value={value}
      onChange={onChange}
      open={open}
      onOpenChange={setOpen}
    />
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

function SettingsBody({
  moduleId,
  controls,
  vectorscopeOptions,
  spectrumOptions,
  channelCount,
  onChange,
}) {
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
    const runtimeOptions = spectrumOptions?.map((option) => ({
      value: channelValue(option.sel),
      label: option.label,
    }));
    const channelOptions = runtimeOptions ?? CHANNEL_OPTIONS;
    const showChannel = channelCount == null ? true : channelCount > 2 && channelOptions.length > 0;
    const showView = channelOptions.length > 0 && controls.channel?.type === "pair";
    return (
      <>
        {showChannel ? (
          <SettingsRow label="Channel">
            <SelectField
              label="Spectrum channel"
              value={channelValue(controls.channel)}
              options={channelOptions}
              onChange={(value) => onChange({ ...controls, channel: parseChannel(value) })}
            />
          </SettingsRow>
        ) : null}
        {showView ? (
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
        ) : null}
        <SpectrumDisplaySettingsRows
          peakHold={controls.peakHold}
          smoothingPercent={controls.smoothingPercent}
          tiltDbPerOctave={controls.tiltDbPerOctave}
          xMinFreq={controls.minFreq}
          xMaxFreq={controls.maxFreq}
          yMinDb={controls.minDb}
          yMaxDb={controls.maxDb}
          onPeakHoldChange={(peakHold) => onChange({ ...controls, peakHold })}
          onSmoothingChange={(smoothingPercent) => onChange({ ...controls, smoothingPercent })}
          onTiltChange={(tiltDbPerOctave) => onChange({ ...controls, tiltDbPerOctave })}
          onXRangeChange={(minFreq, maxFreq) => onChange({ ...controls, minFreq, maxFreq })}
          onYRangeChange={(minDb, maxDb) => onChange({ ...controls, minDb, maxDb })}
        />
      </>
    );
  }
  if (moduleId === "correlation") {
    const pairOptions =
      vectorscopeOptions?.length > 0
        ? vectorscopeOptions.map((option) => ({
            value: option.key,
            label: option.label,
            group: option.group,
          }))
        : [{ value: "0-1", label: "L/R" }];
    const pairValue = `${controls.pair?.x ?? 0}-${controls.pair?.y ?? 1}`;
    return (
      <SettingsRow label="Channel pair">
        <SelectField
          label="Vectorscope channel pair"
          value={pairValue}
          options={pairOptions}
          onChange={(value) => {
            const selected = vectorscopeOptions?.find((option) => option.key === value);
            if (selected) onChange({ ...controls, pair: { x: selected.x, y: selected.y } });
          }}
        />
      </SettingsRow>
    );
  }
  if (moduleId === "stats") {
    return (
      <StatsMetricsSettingsRow
        visibleIds={controls.statsVisibleIds}
        orderedIds={controls.statsOrder}
        onToggle={(id) =>
          onChange({
            ...controls,
            statsVisibleIds: controls.statsVisibleIds.includes(id)
              ? controls.statsVisibleIds.filter((value) => value !== id)
              : [...controls.statsVisibleIds, id],
          })
        }
        onReorder={(statsOrder) => onChange({ ...controls, statsOrder })}
        showReset={false}
      />
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
          <SettingsSlider
            ariaLabel="Waveform window"
            value={controls.windowSec}
            min={5}
            max={120}
            step={1}
            formatValue={(value) => `${value.toFixed(0)} s`}
            onCommit={(windowSec) => onChange({ ...controls, windowSec })}
          />
        </SettingsRow>
      </>
    );
  }
  if (moduleId === "spectrogram") {
    const runtimeOptions = spectrumOptions?.map((option) => ({
      value: channelValue(option.sel),
      label: option.label,
    }));
    const channelOptions = runtimeOptions ?? CHANNEL_OPTIONS;
    const showChannel = channelCount == null ? true : channelCount > 2 && channelOptions.length > 0;
    return (
      <>
        {showChannel ? (
          <SettingsRow label="Channel">
            <SelectField
              label="Spectrogram channel"
              value={channelValue(controls.channel)}
              options={channelOptions}
              onChange={(value) => onChange({ ...controls, channel: parseChannel(value) })}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Level range">
          <SettingsRangeInput
            minAriaLabel="Spectrogram level range min"
            maxAriaLabel="Spectrogram level range max"
            minValue={controls.minDb}
            maxValue={controls.maxDb}
            onCommit={(minDb, maxDb) => onChange({ ...controls, minDb, maxDb })}
          />
        </SettingsRow>
        <SettingsRow label="Frequency range">
          <SettingsRangeInput
            minAriaLabel="Spectrogram frequency range min"
            maxAriaLabel="Spectrogram frequency range max"
            minValue={controls.minFreq}
            maxValue={controls.maxFreq}
            onCommit={(minFreq, maxFreq) => onChange({ ...controls, minFreq, maxFreq })}
          />
        </SettingsRow>
      </>
    );
  }
  return null;
}

export function DockModuleSettings({
  moduleId,
  title,
  controls,
  vectorscopeOptions,
  spectrumOptions,
  channelCount,
  onChange,
  onReset,
  onBack,
}) {
  const dockModuleId = dockModuleIdForPanelModuleId(moduleId) ?? moduleId;
  const entry = DOCK_MODULE_REGISTRY[dockModuleId];
  if (!entry?.settingsFamily || !controls) return null;
  return (
    <DockEditorShell title={`${title ?? entry.label} settings`} onBack={onBack} onReset={onReset}>
      <div className="p-2">
        <SettingsGroup>
          <SettingsBody
            moduleId={dockModuleId}
            controls={controls}
            vectorscopeOptions={vectorscopeOptions}
            spectrumOptions={spectrumOptions}
            channelCount={channelCount}
            onChange={onChange}
          />
        </SettingsGroup>
      </div>
    </DockEditorShell>
  );
}
