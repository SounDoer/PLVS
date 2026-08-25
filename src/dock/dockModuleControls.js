import {
  DEFAULT_PANEL_CONTROLS,
  normalizePanelControlValue,
  normalizePanelControls,
} from "../lib/panelControls.js";

/// The Dock's own readout selector: three states where the Workspace panel has two independent
/// toggles, because the strip has room for one control, not two. No Workspace equivalent, so no
/// row in the control table.
const LEVEL_READOUTS = new Set(["live", "truePeakMax", "playbackMax"]);
const DOCK_MODULE_ID_BY_PANEL_MODULE_ID = Object.freeze({
  levelMeter: "level",
  loudness: "loudness",
  stats: "stats",
  vectorscope: "correlation",
  spectrum: "spectrum",
  spectrogram: "spectrogram",
  waveform: "waveform",
  transport: "transport",
  "stereo-map": "stereoMap",
});

/**
 * Which panel controls each Dock module carries. The Dock stores them under the panel's own keys
 * and repairs them with the panel's rows, so a control has one name and one rule across both
 * surfaces; only the subset differs, because the strip shows less than the panel does.
 */
const DOCK_MODULE_CONTROL_KEYS = Object.freeze({
  level: ["levelMeterMode"],
  loudness: ["loudnessHistoryVisibleLayerIds", "loudnessYMinDb", "loudnessYMaxDb"],
  spectrum: [
    "spectrumChannel",
    "spectrumView",
    "spectrumSpeedPercent",
    "spectrumOctaveSmoothing",
    "spectrumTiltDbPerOctave",
    "spectrumMaxDecay",
    "spectrumMaxHoldTrace",
    "spectrumXMinFreq",
    "spectrumXMaxFreq",
    "spectrumYMinDb",
    "spectrumYMaxDb",
  ],
  correlation: ["vectorscopePair", "vectorscopeMode", "vectorscopePolarLevelMaxHold"],
  stats: ["statsVisibleIds", "statsOrder"],
  spectrogram: ["spectrumChannel", "spectrogramYMinFreq", "spectrogramYMaxFreq"],
  stereoMap: [
    "stereoMapPair",
    "stereoMapMode",
    "stereoMapHold",
    "stereoMapSpeedPercent",
    "stereoMapOctaveSmoothing",
    "stereoMapXMinFreq",
    "stereoMapXMaxFreq",
    "stereoMapMonoLossYMinDb",
    "stereoMapMsRatioYMinDb",
    "stereoMapMsRatioYMaxDb",
  ],
  waveform: [
    "waveformFrequencyColor",
    "waveformLowMidSplitHz",
    "waveformMidHighSplitHz",
    "waveformCentroid",
  ],
});

/// The short, module-scoped keys the Dock stored these controls under before it was put on the
/// panel's names. Read as fallbacks, exactly like the renames inside a panel control's own row:
/// normalizing rewrites the key, so a stored layout upgrades itself the first time it is read.
const LEGACY_DOCK_KEYS = Object.freeze({
  level: { levelMeterMode: ["mode"] },
  spectrum: {
    spectrumChannel: ["channel"],
    spectrumView: ["view"],
    spectrumSpeedPercent: ["speedPercent", "smoothingPercent"],
    spectrumOctaveSmoothing: ["octaveSmoothing"],
    spectrumTiltDbPerOctave: ["tiltDbPerOctave"],
    spectrumMaxDecay: ["maxHold", "peakHold"],
    spectrumXMinFreq: ["minFreq"],
    spectrumXMaxFreq: ["maxFreq"],
    spectrumYMinDb: ["minDb"],
    spectrumYMaxDb: ["maxDb"],
  },
  correlation: {
    vectorscopePair: ["pair"],
    vectorscopeMode: ["mode"],
    vectorscopePolarLevelMaxHold: ["polarLevelMaxHold", "polarLevelPeakHold"],
  },
  spectrogram: {
    spectrumChannel: ["channel"],
    spectrogramYMinFreq: ["minFreq"],
    spectrogramYMaxFreq: ["maxFreq"],
  },
  stereoMap: {
    stereoMapPair: ["pair"],
    stereoMapMode: ["mode"],
    stereoMapHold: ["hold"],
    stereoMapSpeedPercent: ["speedPercent"],
    stereoMapOctaveSmoothing: ["octaveSmoothing"],
    stereoMapXMinFreq: ["minFreq"],
    stereoMapXMaxFreq: ["maxFreq"],
    stereoMapMonoLossYMinDb: ["monoLossMinDb"],
    stereoMapMsRatioYMinDb: ["msRatioMinDb"],
    stereoMapMsRatioYMaxDb: ["msRatioMaxDb"],
  },
  waveform: {
    waveformFrequencyColor: ["frequencyColor"],
    waveformLowMidSplitHz: ["lowMidSplitHz"],
    waveformMidHighSplitHz: ["midHighSplitHz"],
    waveformCentroid: ["centroid"],
  },
});

/// Controls the strip has and the panels do not, so they have no row to read.
const DOCK_ONLY_DEFAULTS = Object.freeze({
  level: Object.freeze({ readout: "live", showLabels: true }),
  loudness: Object.freeze({ showReadouts: true }),
});

function pickDefaults(moduleId) {
  const controls = {};
  for (const key of DOCK_MODULE_CONTROL_KEYS[moduleId]) {
    const value = DEFAULT_PANEL_CONTROLS[key];
    controls[key] = Array.isArray(value)
      ? Object.freeze([...value])
      : value && typeof value === "object"
        ? Object.freeze({ ...value })
        : value;
  }
  return Object.freeze({ ...controls, ...DOCK_ONLY_DEFAULTS[moduleId] });
}

export const DEFAULT_DOCK_CONTROLS_BY_MODULE_ID = Object.freeze(
  Object.fromEntries(
    Object.keys(DOCK_MODULE_CONTROL_KEYS).map((moduleId) => [moduleId, pickDefaults(moduleId)])
  )
);

export const DOCK_CONTROL_MODULE_IDS = Object.freeze(
  Object.keys(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID)
);

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/// The Dock adds two constraints the Workspace panels leave to clampPanelControls: the indices
/// must be non-negative and distinct. A Dock module has no later clamp against the device's
/// channel count, so a degenerate pair would reach the analysis request as-is.
function dockPair(value, fallback) {
  if (value.x >= 0 && value.y >= 0 && value.x !== value.y) {
    return { x: Math.floor(value.x), y: Math.floor(value.y) };
  }
  return { ...fallback };
}

/// Same two extra constraints as dockPair, over the channel selection's pair form.
function dockChannel(value, fallback) {
  if (value.type === "single") {
    return value.ch >= 0 ? { type: "single", ch: Math.floor(value.ch) } : { ...fallback };
  }
  if (value.x >= 0 && value.y >= 0 && value.x !== value.y) {
    return { type: "pair", x: Math.floor(value.x), y: Math.floor(value.y) };
  }
  return { ...fallback };
}

/// Applied after a control's row has repaired it, where the Dock needs the value narrower than
/// the panel does.
const DOCK_TIGHTENED = Object.freeze({
  spectrumChannel: dockChannel,
  vectorscopePair: dockPair,
  stereoMapPair: dockPair,
  spectrumSpeedPercent: (value) => Math.round(value),
  stereoMapSpeedPercent: (value) => Math.round(value),
});

export function normalizeDockStatsVisibleIds(raw) {
  return normalizePanelControlValue("statsVisibleIds", raw);
}

export function normalizeDockStatsOrder(raw) {
  return normalizePanelControlValue("statsOrder", raw);
}

/// The Dock's readout selector is coupled to the meter mode: two of its three states only exist
/// for one mode each, so a stored pairing that no longer applies falls back to the live readout.
function normalizeDockLevelReadout(raw, mode, fallback) {
  const legacy = raw?.readout === "peak" ? "live" : raw?.readout;
  const readout = LEVEL_READOUTS.has(legacy) ? legacy : fallback;
  if (mode === "peak" && readout === "playbackMax") return "live";
  if (mode !== "peak" && readout === "truePeakMax") return "live";
  return readout;
}

function withPanelKeys(moduleId, raw) {
  const source = { ...raw };
  for (const [key, legacyKeys] of Object.entries(LEGACY_DOCK_KEYS[moduleId] ?? {})) {
    for (const legacyKey of legacyKeys) source[key] = source[key] ?? raw?.[legacyKey];
  }
  return source;
}

export function normalizeDockModuleControls(moduleId, raw) {
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults) return null;

  const repaired = normalizePanelControls(withPanelKeys(moduleId, raw));
  const controls = {};
  for (const key of DOCK_MODULE_CONTROL_KEYS[moduleId]) {
    const tighten = DOCK_TIGHTENED[key];
    controls[key] = tighten ? tighten(repaired[key], defaults[key]) : repaired[key];
  }
  if (moduleId === "level") {
    controls.readout = normalizeDockLevelReadout(raw, controls.levelMeterMode, defaults.readout);
    controls.showLabels = bool(raw?.showLabels, bool(raw?.showChannelLabels, defaults.showLabels));
  }
  if (moduleId === "loudness") {
    controls.showReadouts = bool(raw?.showReadouts, defaults.showReadouts);
  }
  return controls;
}

export function isDefaultDockModuleControls(moduleId, controls) {
  return (
    JSON.stringify(normalizeDockModuleControls(moduleId, controls)) ===
    JSON.stringify(
      normalizeDockModuleControls(moduleId, DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId])
    )
  );
}

export function normalizeDockControlsByModuleId(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    DOCK_CONTROL_MODULE_IDS.map((moduleId) => [
      moduleId,
      normalizeDockModuleControls(moduleId, source[moduleId]),
    ])
  );
}

export function updateDockModuleControls(controlsByModuleId, moduleId, nextControls) {
  if (!DOCK_CONTROL_MODULE_IDS.includes(moduleId)) return controlsByModuleId;
  return {
    ...controlsByModuleId,
    [moduleId]: normalizeDockModuleControls(moduleId, nextControls),
  };
}

export function dockControlModuleIdForPanel(panel) {
  return DOCK_MODULE_ID_BY_PANEL_MODULE_ID[panel?.moduleId] ?? panel?.moduleId ?? null;
}

export function normalizeDockControlsByPanelId(
  panelsById = {},
  rawControlsByPanelId,
  fallbackControlsByModuleId
) {
  const rawByPanel =
    rawControlsByPanelId && typeof rawControlsByPanelId === "object" ? rawControlsByPanelId : {};
  const fallbackByModule =
    fallbackControlsByModuleId && typeof fallbackControlsByModuleId === "object"
      ? fallbackControlsByModuleId
      : {};
  return Object.fromEntries(
    Object.entries(panelsById)
      .map(([panelId, panel]) => {
        const controlModuleId = dockControlModuleIdForPanel(panel);
        if (!DOCK_CONTROL_MODULE_IDS.includes(controlModuleId)) return null;
        const raw = rawByPanel[panelId] ?? fallbackByModule[controlModuleId];
        return [panelId, normalizeDockModuleControls(controlModuleId, raw)];
      })
      .filter(Boolean)
  );
}

export function updateDockPanelControls(controlsByPanelId, panelsById, panelId, nextControls) {
  const controlModuleId = dockControlModuleIdForPanel(panelsById?.[panelId]);
  if (!DOCK_CONTROL_MODULE_IDS.includes(controlModuleId)) return controlsByPanelId;
  return {
    ...controlsByPanelId,
    [panelId]: normalizeDockModuleControls(controlModuleId, nextControls),
  };
}

export function controlsByModuleIdFromPanels(
  panelsById = {},
  panelOrder = [],
  controlsByPanelId = {}
) {
  const result = {};
  for (const panelId of panelOrder) {
    const controlModuleId = dockControlModuleIdForPanel(panelsById[panelId]);
    if (!DOCK_CONTROL_MODULE_IDS.includes(controlModuleId) || result[controlModuleId]) continue;
    result[controlModuleId] = normalizeDockModuleControls(
      controlModuleId,
      controlsByPanelId[panelId]
    );
  }
  return normalizeDockControlsByModuleId(result);
}
