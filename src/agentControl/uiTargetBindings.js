import { settingsSurfaceControl } from "./settingsSurfaceCatalog.js";

/**
 * Where a Panel Settings row's value lives in the public Panel Control document. Rows name their
 * pointer target after the stored control key (`panel-control:spectrum:spectrumGrid`), which is not
 * the field `panel update` takes (`grid`). Keys shared by several modules map to the same field in
 * each. `uiTargetBindings.test.js` checks every entry against the public document.
 */
export const PANEL_CONTROL_PUBLIC_PATHS = Object.freeze({
  levelMeterMode: "mode",
  levelMeterPlaybackMax: "playbackMax",
  levelMeterValueMarker: "floatingValue",
  levelMeterTpMaxMarker: "tpMaxMarker",
  levelMeterBarColors: "barColors",
  levelMeterOrientation: "orientation",
  levelMeterPeakWarningDb: "peakThresholdsDbfs",
  levelMeterRmsWarningDb: "rmsThresholdsDbfs",
  levelMeterYMinDb: "levelRangeDbfs",
  loudnessHistoryVisibleLayerIds: "layers",
  loudnessGrid: "grid",
  loudnessOrientation: "orientation",
  loudnessYMinDb: "loudnessRangeLufs",
  waveformFrequencyColor: "frequencyColor",
  waveformLowMidSplitHz: "frequencyBandsHz",
  waveformCentroid: "centroid",
  waveformOrientation: "orientation",
  spectrogramMode: "mode",
  spectrogramDbFloor: "dbFloor",
  spectrogram3dElevationDeg: "threeD.elevationDeg",
  spectrogram3dAzimuthDeg: "threeD.azimuthDeg",
  spectrogram3dHeightGain: "threeD.heightScale",
  spectrogram3dColorize: "threeD.colorize",
  spectrogram3dFloor: "threeD.grid",
  spectrogramOrientation: "orientation",
  spectrumChannel: "channel",
  spectrumView: "view",
  spectrumMaxMode: "maxMode",
  spectrumPeakLabels: "peakLabels",
  spectrumSpeedPercent: "speedPercent",
  spectrumTiltDbPerOctave: "tiltDbPerOctave",
  spectrumOctaveSmoothing: "octaveSmoothing",
  spectrumGrid: "grid",
  spectrumYMinDb: "levelRangeDb",
  stereoMapMode: "mode",
  stereoMapPair: "channelPair",
  stereoMapHold: "maxHold",
  stereoMapSpeedPercent: "speedPercent",
  stereoMapOctaveSmoothing: "octaveSmoothing",
  stereoMapEnergyFadePercent: "energyFadePercent",
  stereoMapColorBlendPercent: "colorBlendPercent",
  stereoMapGrid: "grid",
  stereoMapMonoLossYMinDb: "monoLossFloorDb",
  stereoMapMsRatioYMinDb: "msRatioRangeDb",
  statsVisibleIds: "metrics",
  vectorscopeMode: "mode",
  vectorscopePair: "channelPair",
  vectorscopePolarSamplePersistenceMs: "persistenceMs",
  vectorscopePolarLevelMaxHold: "maxHold",
});

/** Range rows that edit a linked Workspace axis rather than a Panel control. */
export const PANEL_CONTROL_AXES = Object.freeze({
  spectrumXMinFreq: "frequency",
  spectrogramYMinFreq: "frequency",
  stereoMapXMinFreq: "frequency",
  historyWindowSec: "time",
});

function settingsBinding(id) {
  let control;
  try {
    control = settingsSurfaceControl(id);
  } catch {
    return null;
  }
  if (control.owner !== "settings") return null;
  const [, name] = id.split(".");
  return {
    command: "settings update",
    path: control.field === "updates" ? `updates.${name}` : control.field,
  };
}

/**
 * The command and field that change what a pointer target shows, when the target is a value an
 * Agent Control mutation owns. Buttons, tabs and actions have none.
 *
 * @param {string} id
 * @returns {{ command: string, panelId?: string, path?: string, axis?: string } | null}
 */
export function uiTargetBinding(id) {
  const [kind, ...rest] = id.split(":");
  if (kind === "panel-control" && rest.length === 2) {
    const [panelId, key] = rest;
    if (PANEL_CONTROL_PUBLIC_PATHS[key]) {
      return { command: "panel update", panelId, path: PANEL_CONTROL_PUBLIC_PATHS[key] };
    }
    if (PANEL_CONTROL_AXES[key]) {
      return { command: "axis panel update", panelId, axis: PANEL_CONTROL_AXES[key] };
    }
    return null;
  }
  if (kind === "setting" && rest.length === 1) {
    const [name] = rest;
    if (name.startsWith("shortcuts.")) {
      return { command: "settings update", path: `keyboardShortcuts.${name.slice(10)}` };
    }
    if (name.startsWith("channels.role.")) {
      return { command: "settings update", path: "channelLabels.roles" };
    }
    if (name === "channels.layout")
      return { command: "settings update", path: "channelLabels.layout" };
    if (name === "channels.resetLabels") return null;
    return settingsBinding(name);
  }
  return null;
}
