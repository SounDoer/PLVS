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
  WaveformSettingsRows,
} from "../../components/PanelSettingsContent.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";
import { dockModuleIdForPanelModuleId } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { isDefaultDockModuleControls, normalizeDockModuleControls } from "../dockModuleControls.js";
import {
  LEVEL_METER_MODE_OPTIONS,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
  SPECTRUM_TILT_TOOLTIP,
  VECTORSCOPE_MODE_OPTIONS,
} from "../../lib/panelControls.js";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";

const STEREO_MAP_MODE_OPTIONS = [
  { id: STEREO_MAP_MODES.POSITION, label: "Position" },
  { id: STEREO_MAP_MODES.CORRELATION, label: "Correlation" },
  { id: STEREO_MAP_MODES.MONO_LOSS_DB, label: "Mono Loss" },
  { id: STEREO_MAP_MODES.MS_RATIO_DB, label: "M/S Ratio" },
];

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
    const isPeak = controls.levelMeterMode === "peak";
    const readoutOptions = isPeak
      ? [
          { value: "live", label: "Live" },
          { value: "truePeakMax", label: "TP Max" },
        ]
      : [
          { value: "live", label: "Live" },
          { value: "playbackMax", label: "Playback Max" },
        ];
    return (
      <>
        <SettingsRow label="Mode">
          <SelectField
            label="Level mode"
            value={controls.levelMeterMode}
            options={LEVEL_METER_MODE_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
            onChange={(levelMeterMode) =>
              onChange({
                ...controls,
                levelMeterMode,
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
      <>
        <LoudnessSettingsRows
          visibleLayerIds={controls.loudnessHistoryVisibleLayerIds}
          yMinDb={controls.loudnessYMinDb}
          yMaxDb={controls.loudnessYMaxDb}
          onVisibleLayerIdsChange={(loudnessHistoryVisibleLayerIds) =>
            onChange({ ...controls, loudnessHistoryVisibleLayerIds })
          }
          onYRangeChange={(loudnessYMinDb, loudnessYMaxDb) =>
            onChange({ ...controls, loudnessYMinDb, loudnessYMaxDb })
          }
        />
        <SettingsRow label="Readouts">
          <SettingsSwitch
            aria-label="Show Loudness readouts"
            checked={controls.showReadouts}
            onCheckedChange={(showReadouts) => onChange({ ...controls, showReadouts })}
          />
        </SettingsRow>
      </>
    );
  }
  if (moduleId === "spectrum") {
    const runtimeOptions = spectrumOptions?.map((option) => ({
      value: channelValue(option.sel),
      label: option.label,
    }));
    const channelOptions = runtimeOptions ?? CHANNEL_OPTIONS;
    const showChannel = channelCount == null ? true : channelCount > 2 && channelOptions.length > 0;
    const showView = channelOptions.length > 0 && controls.spectrumChannel?.type === "pair";
    return (
      <>
        {showChannel ? (
          <SettingsRow label="Channel">
            <SelectField
              label="Spectrum channel"
              value={channelValue(controls.spectrumChannel)}
              options={channelOptions}
              onChange={(value) => onChange({ ...controls, spectrumChannel: parseChannel(value) })}
            />
          </SettingsRow>
        ) : null}
        {showView ? (
          <SettingsRow label="View">
            <SelectField
              label="Spectrum view"
              value={controls.spectrumView}
              options={[
                { value: "combined", label: "Combined" },
                { value: "lr", label: "L / R" },
                { value: "ms", label: "M / S" },
              ]}
              onChange={(spectrumView) => onChange({ ...controls, spectrumView })}
            />
          </SettingsRow>
        ) : null}
        <SpectrumDisplaySettingsRows
          showPeakLabels={false}
          maxMode={controls.spectrumMaxMode}
          speedPercent={controls.spectrumSpeedPercent}
          octaveSmoothing={controls.spectrumOctaveSmoothing}
          tiltDbPerOctave={controls.spectrumTiltDbPerOctave}
          xMinFreq={controls.spectrumXMinFreq}
          xMaxFreq={controls.spectrumXMaxFreq}
          yMinDb={controls.spectrumYMinDb}
          yMaxDb={controls.spectrumYMaxDb}
          onMaxModeChange={(spectrumMaxMode) => onChange({ ...controls, spectrumMaxMode })}
          onSpeedChange={(spectrumSpeedPercent) => onChange({ ...controls, spectrumSpeedPercent })}
          onOctaveSmoothingChange={(spectrumOctaveSmoothing) =>
            onChange({ ...controls, spectrumOctaveSmoothing })
          }
          onTiltChange={(spectrumTiltDbPerOctave) =>
            onChange({ ...controls, spectrumTiltDbPerOctave })
          }
          onXRangeChange={(spectrumXMinFreq, spectrumXMaxFreq) =>
            onChange({ ...controls, spectrumXMinFreq, spectrumXMaxFreq })
          }
          onYRangeChange={(spectrumYMinDb, spectrumYMaxDb) =>
            onChange({ ...controls, spectrumYMinDb, spectrumYMaxDb })
          }
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
    const pairValue = `${controls.vectorscopePair?.x ?? 0}-${controls.vectorscopePair?.y ?? 1}`;
    return (
      <>
        <SettingsRow label="Mode">
          <SelectField
            label="Vectorscope mode"
            value={controls.vectorscopeMode}
            options={VECTORSCOPE_MODE_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
            onChange={(vectorscopeMode) => onChange({ ...controls, vectorscopeMode })}
          />
        </SettingsRow>
        <SettingsRow label="Channel Pair">
          <SelectField
            label="Vectorscope channel pair"
            value={pairValue}
            options={pairOptions}
            onChange={(value) => {
              const selected = vectorscopeOptions?.find((option) => option.key === value);
              if (selected)
                onChange({ ...controls, vectorscopePair: { x: selected.x, y: selected.y } });
            }}
          />
        </SettingsRow>
        {controls.vectorscopeMode === "polarLevel" ? (
          <SettingsRow label="Max Hold">
            <SettingsSwitch
              aria-label="Vectorscope max hold"
              checked={controls.vectorscopePolarLevelMaxHold}
              onCheckedChange={(vectorscopePolarLevelMaxHold) =>
                onChange({ ...controls, vectorscopePolarLevelMaxHold })
              }
            />
          </SettingsRow>
        ) : null}
      </>
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
      <WaveformSettingsRows
        frequencyColor={controls.waveformFrequencyColor}
        lowMidSplitHz={controls.waveformLowMidSplitHz}
        midHighSplitHz={controls.waveformMidHighSplitHz}
        centroid={controls.waveformCentroid}
        onFrequencyColorChange={(waveformFrequencyColor) =>
          onChange({ ...controls, waveformFrequencyColor })
        }
        onLowMidSplitChange={(waveformLowMidSplitHz) =>
          onChange({ ...controls, waveformLowMidSplitHz })
        }
        onMidHighSplitChange={(waveformMidHighSplitHz) =>
          onChange({ ...controls, waveformMidHighSplitHz })
        }
        onCentroidChange={(waveformCentroid) => onChange({ ...controls, waveformCentroid })}
      />
    );
  }
  if (moduleId === "stereoMap") {
    const pairOptions =
      vectorscopeOptions?.length > 0
        ? vectorscopeOptions.map((option) => ({
            value: option.key,
            label: option.label,
            group: option.group,
          }))
        : [{ value: "0-1", label: "L/R" }];
    const pairValue = `${controls.stereoMapPair?.x ?? 0}-${controls.stereoMapPair?.y ?? 1}`;
    const isMonoLoss = controls.stereoMapMode === STEREO_MAP_MODES.MONO_LOSS_DB;
    const isMsRatio = controls.stereoMapMode === STEREO_MAP_MODES.MS_RATIO_DB;
    return (
      <>
        <SettingsRow label="Mode">
          <SelectField
            label="Stereo Map mode"
            value={controls.stereoMapMode}
            options={STEREO_MAP_MODE_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
            onChange={(stereoMapMode) => onChange({ ...controls, stereoMapMode })}
          />
        </SettingsRow>
        <SettingsRow label="Channel Pair">
          <SelectField
            label="Stereo Map channel pair"
            value={pairValue}
            options={pairOptions}
            onChange={(value) => {
              const selected = vectorscopeOptions?.find((option) => option.key === value);
              if (selected)
                onChange({ ...controls, stereoMapPair: { x: selected.x, y: selected.y } });
            }}
          />
        </SettingsRow>
        <SettingsRow label="Max Hold">
          <SettingsSwitch
            aria-label="Stereo Map max hold"
            checked={controls.stereoMapHold}
            onCheckedChange={(stereoMapHold) => onChange({ ...controls, stereoMapHold })}
          />
        </SettingsRow>
        <SettingsRow label="Speed">
          <SettingsSlider
            ariaLabel="Stereo Map speed"
            min={0}
            max={100}
            step={1}
            value={controls.stereoMapSpeedPercent}
            formatValue={(value) => `${value.toFixed(0)}%`}
            onCommit={(stereoMapSpeedPercent) => onChange({ ...controls, stereoMapSpeedPercent })}
            commitOnRelease
          />
        </SettingsRow>
        <SettingsRow
          label="Smoothing"
          tooltip="Averages the primitives across frequency before deriving Mode values. Speed smooths over time; this smooths over frequency."
        >
          <SelectField
            label="Stereo Map smoothing"
            value={controls.stereoMapOctaveSmoothing}
            options={SPECTRUM_OCTAVE_SMOOTHING_OPTIONS.map(({ id, label }) => ({
              value: id,
              label,
            }))}
            onChange={(stereoMapOctaveSmoothing) =>
              onChange({ ...controls, stereoMapOctaveSmoothing })
            }
          />
        </SettingsRow>
        <SettingsRow label="Frequency Range">
          <SettingsRangeInput
            minAriaLabel="stereo map frequency range min"
            maxAriaLabel="stereo map frequency range max"
            minValue={controls.stereoMapXMinFreq}
            maxValue={controls.stereoMapXMaxFreq}
            onCommit={(stereoMapXMinFreq, stereoMapXMaxFreq) =>
              onChange({ ...controls, stereoMapXMinFreq, stereoMapXMaxFreq })
            }
          />
        </SettingsRow>
        {isMonoLoss ? (
          <SettingsRow label="Level Range">
            <SettingsRangeInput
              minAriaLabel="stereo map mono loss level range min"
              maxAriaLabel="stereo map mono loss level range max"
              minValue={controls.stereoMapMonoLossYMinDb}
              maxValue={0}
              onCommit={(stereoMapMonoLossYMinDb) =>
                onChange({ ...controls, stereoMapMonoLossYMinDb })
              }
            />
          </SettingsRow>
        ) : null}
        {isMsRatio ? (
          <SettingsRow label="Level Range">
            <SettingsRangeInput
              minAriaLabel="stereo map m/s ratio level range min"
              maxAriaLabel="stereo map m/s ratio level range max"
              minValue={controls.stereoMapMsRatioYMinDb}
              maxValue={controls.stereoMapMsRatioYMaxDb}
              onCommit={(stereoMapMsRatioYMinDb, stereoMapMsRatioYMaxDb) =>
                onChange({ ...controls, stereoMapMsRatioYMinDb, stereoMapMsRatioYMaxDb })
              }
            />
          </SettingsRow>
        ) : null}
      </>
    );
  }
  if (moduleId === "spectrogram") {
    // Repaired before it is read: the editor is handed the stored record as-is, and a layout
    // written before a key existed -- or under the Dock's older short names -- carries neither
    // the value nor a shape a slider can format.
    const spectrogramControls = normalizeDockModuleControls("spectrogram", controls);
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
              value={channelValue(spectrogramControls.spectrumChannel)}
              options={channelOptions}
              onChange={(value) =>
                onChange({ ...spectrogramControls, spectrumChannel: parseChannel(value) })
              }
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Tilt" tooltip={SPECTRUM_TILT_TOOLTIP}>
          <SettingsSlider
            ariaLabel="spectrogram tilt"
            min={0}
            max={6}
            step={0.25}
            value={spectrogramControls.spectrumTiltDbPerOctave}
            formatValue={(value) => `${value.toFixed(2)} dB/oct`}
            onCommit={(spectrumTiltDbPerOctave) =>
              onChange({ ...spectrogramControls, spectrumTiltDbPerOctave })
            }
          />
        </SettingsRow>
        <SettingsRow label="Frequency Range">
          <SettingsRangeInput
            minAriaLabel="spectrogram frequency range min"
            maxAriaLabel="spectrogram frequency range max"
            minValue={spectrogramControls.spectrogramYMinFreq}
            maxValue={spectrogramControls.spectrogramYMaxFreq}
            onCommit={(spectrogramYMinFreq, spectrogramYMaxFreq) =>
              onChange({ ...spectrogramControls, spectrogramYMinFreq, spectrogramYMaxFreq })
            }
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
    <DockEditorShell
      title={title ?? entry.label}
      onBack={onBack}
      onReset={onReset}
      resetIsDefault={isDefaultDockModuleControls(dockModuleId, controls)}
    >
      <div>
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
