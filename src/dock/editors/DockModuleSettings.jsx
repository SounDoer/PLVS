import { useState } from "react";
import { LoudnessLayersControl } from "../../components/panel-settings/LoudnessSettings.jsx";
import { ControlRows } from "../../components/panel-settings/PanelControlRows.jsx";
import { toggleId } from "../../components/panel-settings/selectionKeys.js";
import { StatsMetricsSettingsRow } from "../../components/panel-settings/StatsSettings.jsx";
import { WaveformSplitRows } from "../../components/panel-settings/WaveformSettings.jsx";
import { SettingsGroup, SettingsSelect } from "../../components/panel-settings/SettingsWidgets.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";
import { dockModuleIdForPanelModuleId } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import {
  dockSettingsRows,
  dockSettingsTab,
  isDefaultDockModuleControls,
} from "../dockModuleControls.js";
import { SPECTRUM_VIEW_OPTIONS } from "../../math/spectrumChannelViewOptions.js";

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

/** The channel-pair select the Vectorscope and the Stereo Map share, over one stored key each. */
function PairField({ label, pairKey, controls, vectorscopeOptions, onChange }) {
  const pairOptions =
    vectorscopeOptions?.length > 0
      ? vectorscopeOptions.map((option) => ({
          value: option.key,
          label: option.label,
          group: option.group,
        }))
      : [{ value: "0-1", label: "L/R" }];
  return (
    <SelectField
      label={label}
      value={`${controls[pairKey]?.x ?? 0}-${controls[pairKey]?.y ?? 1}`}
      options={pairOptions}
      onChange={(value) => {
        const selected = vectorscopeOptions?.find((option) => option.key === value);
        if (selected) onChange({ [pairKey]: { x: selected.x, y: selected.y } });
      }}
    />
  );
}

/**
 * The controls the table gives a place but cannot draw: their options come from the device, the
 * meter mode or the active Loudness Profile. Keyed by the control they edit.
 */
function dockSlots({
  moduleId,
  controls,
  vectorscopeOptions,
  spectrumOptions,
  channelCount,
  patch,
}) {
  if (moduleId === "level") {
    const readoutOptions =
      controls.levelMeterMode === "peak"
        ? [
            { value: "live", label: "Live" },
            { value: "truePeakMax", label: "TP Max" },
          ]
        : [
            { value: "live", label: "Live" },
            { value: "playbackMax", label: "Playback Max" },
          ];
    return {
      readout: (
        <SelectField
          label="level readout"
          value={controls.readout}
          options={readoutOptions}
          onChange={(readout) => patch({ readout })}
        />
      ),
    };
  }
  if (moduleId === "loudness") {
    return {
      loudnessHistoryVisibleLayerIds: (
        <LoudnessLayersControl
          visibleLayerIds={controls.loudnessHistoryVisibleLayerIds}
          onVisibleLayerIdsChange={(loudnessHistoryVisibleLayerIds) =>
            patch({ loudnessHistoryVisibleLayerIds })
          }
        />
      ),
    };
  }
  if (moduleId === "spectrum" || moduleId === "spectrogram") {
    const runtimeOptions = spectrumOptions?.map((option) => ({
      value: channelValue(option.sel),
      label: option.label,
    }));
    const channelOptions = runtimeOptions ?? CHANNEL_OPTIONS;
    const showChannel = channelCount == null ? true : channelCount > 2 && channelOptions.length > 0;
    const showView = channelOptions.length > 0 && controls.spectrumChannel?.type === "pair";
    return {
      spectrumChannel: showChannel ? (
        <SelectField
          label={`${moduleId} channel`}
          value={channelValue(controls.spectrumChannel)}
          options={channelOptions}
          onChange={(value) => patch({ spectrumChannel: parseChannel(value) })}
        />
      ) : null,
      // Only the Spectrum has a View row; the Spectrogram's rows have no place for this slot.
      spectrumView: showView ? (
        <SelectField
          label="spectrum view"
          value={controls.spectrumView}
          options={SPECTRUM_VIEW_OPTIONS.map(({ key, label }) => ({ value: key, label }))}
          onChange={(spectrumView) => patch({ spectrumView })}
        />
      ) : null,
    };
  }
  if (moduleId === "correlation") {
    return {
      vectorscopePair: (
        <PairField
          label="vectorscope channel"
          pairKey="vectorscopePair"
          controls={controls}
          vectorscopeOptions={vectorscopeOptions}
          onChange={patch}
        />
      ),
    };
  }
  if (moduleId === "stereoMap") {
    return {
      stereoMapPair: (
        <PairField
          label="stereo map channel"
          pairKey="stereoMapPair"
          controls={controls}
          vectorscopeOptions={vectorscopeOptions}
          onChange={patch}
        />
      ),
    };
  }
  if (moduleId === "stats") {
    return {
      statsVisibleIds: (
        <StatsMetricsSettingsRow
          visibleIds={controls.statsVisibleIds}
          orderedIds={controls.statsOrder}
          onToggle={(id) => patch({ statsVisibleIds: toggleId(controls.statsVisibleIds, id) })}
          onReorder={(statsOrder) => patch({ statsOrder })}
        />
      ),
    };
  }
  if (moduleId === "waveform") {
    return {
      waveformLowMidSplitHz: (
        <WaveformSplitRows
          lowMidSplitHz={controls.waveformLowMidSplitHz}
          midHighSplitHz={controls.waveformMidHighSplitHz}
          onLowMidSplitChange={(waveformLowMidSplitHz) => patch({ waveformLowMidSplitHz })}
          onMidHighSplitChange={(waveformMidHighSplitHz) => patch({ waveformMidHighSplitHz })}
        />
      ),
    };
  }
  return {};
}

/**
 * @param {{
 *   moduleId: string,
 *   title: string,
 *   controls: any,
 *   vectorscopeOptions: any[],
 *   spectrumOptions: any[],
 *   channelCount: number,
 *   onChange: (...args: any[]) => any,
 *   onReset: (...args: any[]) => any,
 *   onBack: (...args: any[]) => any,
 * }} props
 */
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
  // The rows report the keys they touch; the Dock's record is the module's own, so the patch is
  // merged here and repaired where the Dock stores it. A new meter mode starts on the live
  // readout: the two other readouts each exist for one mode only.
  const patch = (changes) =>
    onChange({
      ...controls,
      ...changes,
      ...("levelMeterMode" in changes ? { readout: "live" } : null),
    });
  return (
    <DockEditorShell
      title={title ?? entry.label}
      onBack={onBack}
      onReset={onReset}
      resetIsDefault={isDefaultDockModuleControls(dockModuleId, controls)}
    >
      <div>
        <SettingsGroup>
          <ControlRows
            rows={dockSettingsRows(dockModuleId)}
            tab={dockSettingsTab(dockModuleId)}
            controls={controls}
            onChange={patch}
            slots={dockSlots({
              moduleId: dockModuleId,
              controls,
              vectorscopeOptions,
              spectrumOptions,
              channelCount,
              patch,
            })}
          />
        </SettingsGroup>
      </div>
    </DockEditorShell>
  );
}
