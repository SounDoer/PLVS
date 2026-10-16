/** @import { PanelControls } from "../workspace/types.js" */
import {
  DEFAULT_PANEL_CONTROLS,
  normalizePanelControlValue,
  normalizePanelControls,
  panelControlUiRows,
} from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

/// Legacy persisted readouts and the Agent Control compatibility alias. The UI now uses the
/// normal panel's independent Max/marker switches; old values migrate to those shared controls.
const LEVEL_READOUTS = new Set(["live", "truePeakMax", "playbackMax"]);
const DOCK_MODULE_ID_BY_PANEL_MODULE_ID = Object.freeze({
  levelMeter: "level",
  loudness: "loudness",
  stats: "stats",
  vectorscope: "correlation",
  spectrum: "spectrum",
  spectrogram: "spectrogram",
  waveform: "waveform",
  "stereo-map": "stereoMap",
});

/**
 * Which panel controls each Dock module carries. The Dock stores them under the panel's own keys
 * and repairs them with the panel's rows, so a control has one name and one rule across both
 * surfaces. Time and frequency membership use the shared Workspace viewports.
 */
const DOCK_MODULE_CONTROL_KEYS = Object.freeze(
  /** @type {const} */ ({
    level: [
      "levelMeterMode",
      "levelMeterOrientation",
      "levelMeterPlaybackMax",
      "levelMeterValueMarker",
      "levelMeterTpMaxMarker",
      "levelMeterYMinDb",
      "levelMeterYMaxDb",
      "loudnessYMinDb",
      "loudnessYMaxDb",
      "levelMeterBarColors",
      "levelMeterPeakWarningDb",
      "levelMeterPeakCriticalDb",
      "levelMeterRmsWarningDb",
      "levelMeterRmsCriticalDb",
    ],
    loudness: [
      "loudnessOrientation",
      "loudnessHistoryVisibleLayerIds",
      "loudnessYMinDb",
      "loudnessYMaxDb",
      "loudnessGrid",
      "linkTimeViewport",
      "historyWindowSec",
      "historyOffsetSec",
    ],
    spectrum: [
      "spectrumChannel",
      "spectrumView",
      "spectrumSpeedPercent",
      "spectrumOctaveSmoothing",
      "spectrumTiltDbPerOctave",
      "spectrumMaxMode",
      "spectrumPeakLabels",
      "spectrumGrid",
      "linkFrequencyViewport",
      "spectrumXMinFreq",
      "spectrumXMaxFreq",
      "spectrumYMinDb",
      "spectrumYMaxDb",
    ],
    correlation: [
      "vectorscopePair",
      "vectorscopeMode",
      "vectorscopePolarSamplePersistenceMs",
      "vectorscopePolarLevelMaxHold",
    ],
    stats: ["statsVisibleIds", "statsOrder"],
    spectrogram: [
      "spectrogramOrientation",
      "spectrogramMode",
      "spectrogram3dColorize",
      "spectrogram3dHeightGain",
      "spectrogram3dAzimuthDeg",
      "spectrogram3dElevationDeg",
      "spectrogram3dFloor",
      "spectrumOctaveSmoothing",
      "linkTimeViewport",
      "historyWindowSec",
      "historyOffsetSec",
      "spectrumChannel",
      "spectrumTiltDbPerOctave",
      "spectrogramDbFloor",
      "linkFrequencyViewport",
      "spectrogramYMinFreq",
      "spectrogramYMaxFreq",
    ],
    stereoMap: [
      "stereoMapPair",
      "stereoMapMode",
      "stereoMapHold",
      "stereoMapGrid",
      "stereoMapSpeedPercent",
      "stereoMapOctaveSmoothing",
      "stereoMapEnergyFadePercent",
      "stereoMapColorBlendPercent",
      "linkFrequencyViewport",
      "stereoMapXMinFreq",
      "stereoMapXMaxFreq",
      "stereoMapMonoLossYMinDb",
      "stereoMapMsRatioYMinDb",
      "stereoMapMsRatioYMaxDb",
    ],
    waveform: [
      "waveformOrientation",
      "linkTimeViewport",
      "historyWindowSec",
      "historyOffsetSec",
      "waveformFrequencyColor",
      "waveformLowMidSplitHz",
      "waveformMidHighSplitHz",
      "waveformCentroid",
    ],
  })
);

/// The short, module-scoped keys the Dock stored these controls under before it was put on the
/// panel's names. Read as fallbacks, exactly like the renames inside a panel control's own row:
/// normalizing rewrites the key, so a stored layout upgrades itself the first time it is read.
const LEGACY_DOCK_KEYS = Object.freeze({
  level: { levelMeterMode: ["mode"] },
  spectrum: {
    spectrumChannel: ["channel"],
    spectrumView: ["view"],
    // Not a key in the record any more: the Max mode row reads spectrumMaxDecay as one of the
    // switches it replaced, so mapping the Dock's short names onto it lets one migration serve
    // both surfaces.
    spectrumMaxDecay: ["maxHold", "peakHold"],
    spectrumSpeedPercent: ["speedPercent", "smoothingPercent"],
    spectrumOctaveSmoothing: ["octaveSmoothing"],
    spectrumTiltDbPerOctave: ["tiltDbPerOctave"],
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

const PANEL_MODULE_ID_BY_DOCK_MODULE_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(DOCK_MODULE_ID_BY_PANEL_MODULE_ID).map(([panel, dock]) => [dock, panel])
  )
);

/// The settings rows of the controls only the strip has, in the table's row shape so one renderer
/// draws both. `order` places each among the panel's rows; their defaults are DOCK_ONLY_DEFAULTS.
const DOCK_ONLY_ROWS = Object.freeze({});
const DOCK_ROW_UI_OVERRIDES = Object.freeze({});

/** The panel settings tab a Dock module's rows come from. */
export function dockSettingsTab(moduleId) {
  return PANEL_MODULE_ID_BY_DOCK_MODULE_ID[moduleId];
}

/**
 * The settings rows one Dock module shows: the panel's rows for the controls this module carries,
 * in the panel's order. The Dock reads the same table as the panel settings, so a control's label,
 * bounds, step and commit rule are stated once; what differs here is only which controls there are.
 * @param {string} moduleId
 */
export function dockSettingsRows(moduleId) {
  const keys = DOCK_MODULE_CONTROL_KEYS[moduleId];
  if (!keys) return [];
  const overrides = DOCK_ROW_UI_OVERRIDES[moduleId] ?? {};
  const shared = panelControlUiRows(dockSettingsTab(moduleId))
    .filter((row) => keys.includes(row.key ?? row.minKey))
    .map((row) => {
      const override = overrides[row.key ?? row.minKey];
      return override ? { ...row, ui: { ...row.ui, ...override } } : row;
    });
  return [...shared, ...(DOCK_ONLY_ROWS[moduleId] ?? [])].sort(
    (a, b) => (a.ui.order ?? 0) - (b.ui.order ?? 0)
  );
}

/// Controls the strip has and the panels do not, so they have no row to read.
const DOCK_ONLY_DEFAULTS = Object.freeze({
  level: Object.freeze({ readout: "live", showLabels: true }),
});

/**
 * @param {string} moduleId
 */
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
  spectrumSpeedPercent: (/** @type {number} */ value) => Math.round(value),
  stereoMapSpeedPercent: (/** @type {number} */ value) => Math.round(value),
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

/**
 * @param {string} moduleId
 */
function withPanelKeys(moduleId, raw) {
  const source = { ...raw };
  if (moduleId === "level") {
    source.levelMeterTpMaxMarker ??= raw?.readout === "truePeakMax";
    source.levelMeterPlaybackMax ??= raw?.readout === "playbackMax";
    source.levelMeterValueMarker ??= raw?.readout === "playbackMax";
  }
  for (const [key, legacyKeys] of Object.entries(LEGACY_DOCK_KEYS[moduleId] ?? {})) {
    for (const legacyKey of legacyKeys) source[key] = source[key] ?? raw?.[legacyKey];
  }
  return source;
}

/**
 * @typedef {keyof typeof DOCK_MODULE_CONTROL_KEYS} DockModuleId
 */
/**
 * What one Dock module stores: its subset of the panel controls, plus the controls only the strip
 * has.
 * @template {DockModuleId} M
 * @typedef {Pick<PanelControls, (typeof DOCK_MODULE_CONTROL_KEYS)[M][number]> &
 *   (M extends "level" ? { readout: string, showLabels: boolean } : {}) &
 *   {}} DockModuleControls
 */

/**
 * What the strip gives every module alongside that module's own stored controls: the shared
 * transport state, instance identity and the owner callback for persisted control edits.
 * @typedef {{
 *   controlsByPanelId?: Record<string, object>,
 *   sourceTransportState?: any,
 *   onSourceTransportAction?: (action: string) => void,
 *   panelId?: string,
 *   sharedFrequencyViewport?: { min: number, max: number },
 *   onSharedFrequencyChange?: (range: { min: number, max: number }) => void,
 *   onDockPanelControlsChange?: (panelId: string, controls: any) => void,
 * }} DockStripControls
 */
/**
 * The `controls` prop of one Dock module: its own controls, as far as they are stored, merged
 * over what the strip shares with all of them.
 * @template {DockModuleId} M
 * @typedef {Partial<DockModuleControls<M>> & DockStripControls} DockModuleProps
 */

/**
 * @template {DockModuleId} M
 * @overload
 * @param {M} moduleId
 * @param {unknown} raw
 * @returns {DockModuleControls<M>}
 */
/**
 * @overload
 * @param {string} moduleId
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
/**
 * Repairs one module's stored controls. A module id that is not a Dock module has none.
 * @param {string} moduleId
 * @param {any} raw
 * @returns {Record<string, unknown> | null}
 */
export function normalizeDockModuleControls(moduleId, raw) {
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults) return null;

  const repaired = normalizePanelControls(withPanelKeys(moduleId, raw));
  /** @type {Record<string, unknown>} */
  const controls = {};
  for (const key of DOCK_MODULE_CONTROL_KEYS[moduleId]) {
    const tighten = DOCK_TIGHTENED[key];
    controls[key] = tighten ? tighten(repaired[key], defaults[key]) : repaired[key];
  }
  if (moduleId === "level") {
    controls.readout = normalizeDockLevelReadout(raw, controls.levelMeterMode, defaults.readout);
    controls.showLabels = bool(raw?.showLabels, bool(raw?.showChannelLabels, defaults.showLabels));
  }
  return controls;
}

/**
 * @param {string} moduleId
 */
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

/// Controls the first-run Dock panels carry on top of the Dock defaults, by Dock control module id.
/// Only the first-run strip and Reset Layout use them; a panel added later starts from the defaults.
/// Where a control exists on both sides, the value matches the first-run workspace panel
/// (`FIRST_RUN_PANEL_CONTROLS`), so entering Dock shows the same reading.
const FIRST_RUN_DOCK_CONTROLS = Object.freeze({
  loudness: { loudnessYMinDb: -48, loudnessYMaxDb: -6 },
  stats: { statsVisibleIds: [...STATS_CANONICAL_ORDER] },
  correlation: { vectorscopeMode: "polarLevel", vectorscopePolarLevelMaxHold: true },
  spectrum: { spectrumView: "ms", spectrumMaxMode: "decay", spectrumYMinDb: -84 },
  waveform: { waveformFrequencyColor: true, waveformCentroid: true },
});

export function firstRunDockControlsByModuleId() {
  return normalizeDockControlsByModuleId(
    Object.fromEntries(
      Object.entries(FIRST_RUN_DOCK_CONTROLS).map(([moduleId, overrides]) => [
        moduleId,
        { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId], ...overrides },
      ])
    )
  );
}

/**
 * @param {string} moduleId
 */
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
