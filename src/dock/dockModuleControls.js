import { normalizeReferenceLufs } from "../settings/defaults.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
import {
  DEFAULT_PANEL_CONTROLS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
  VECTORSCOPE_MODE_OPTIONS,
} from "../lib/panelControls.js";

const SPECTRUM_VIEWS = new Set(["combined", "lr", "ms"]);
const SPECTRUM_OCTAVE_SMOOTHING_IDS = new Set(
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS.map((option) => option.id)
);
const LOUDNESS_HISTORY_LAYER_IDS = new Set(
  LOUDNESS_HISTORY_LAYER_OPTIONS.map((option) => option.id)
);
const LEVEL_MODES = new Set(["peak", "rms", "momentary", "shortTerm"]);
const LEVEL_READOUTS = new Set(["live", "truePeakMax", "playbackMax"]);
const VECTORSCOPE_MODES = new Set(VECTORSCOPE_MODE_OPTIONS.map((option) => option.id));
const DOCK_MODULE_ID_BY_PANEL_MODULE_ID = Object.freeze({
  levelMeter: "level",
  loudness: "loudness",
  stats: "stats",
  vectorscope: "correlation",
  spectrum: "spectrum",
  spectrogram: "spectrogram",
  waveform: "waveform",
  transport: "transport",
});

const DEFAULT_DOCK_STATS_VISIBLE_IDS = DEFAULT_PANEL_CONTROLS.statsVisibleIds;
const DEFAULT_DOCK_STATS_ORDER = DEFAULT_PANEL_CONTROLS.statsOrder;

export const DEFAULT_DOCK_CONTROLS_BY_MODULE_ID = Object.freeze({
  level: Object.freeze({
    mode: DEFAULT_PANEL_CONTROLS.levelMeterMode,
    readout: "live",
    showLabels: true,
  }),
  loudness: Object.freeze({
    showReadouts: true,
    loudnessReferenceLufs: DEFAULT_PANEL_CONTROLS.loudnessReferenceLufs,
    loudnessHistoryVisibleLayerIds: Object.freeze([
      ...DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds,
    ]),
    loudnessYMinDb: DEFAULT_PANEL_CONTROLS.loudnessYMinDb,
    loudnessYMaxDb: DEFAULT_PANEL_CONTROLS.loudnessYMaxDb,
  }),
  spectrum: Object.freeze({
    channel: Object.freeze({ ...DEFAULT_PANEL_CONTROLS.spectrumChannel }),
    view: DEFAULT_PANEL_CONTROLS.spectrumView,
    speedPercent: DEFAULT_PANEL_CONTROLS.spectrumSpeedPercent,
    octaveSmoothing: DEFAULT_PANEL_CONTROLS.spectrumOctaveSmoothing,
    tiltDbPerOctave: DEFAULT_PANEL_CONTROLS.spectrumTiltDbPerOctave,
    maxHold: DEFAULT_PANEL_CONTROLS.spectrumMaxHold,
    minFreq: DEFAULT_PANEL_CONTROLS.spectrumXMinFreq,
    maxFreq: DEFAULT_PANEL_CONTROLS.spectrumXMaxFreq,
    minDb: DEFAULT_PANEL_CONTROLS.spectrumYMinDb,
    maxDb: DEFAULT_PANEL_CONTROLS.spectrumYMaxDb,
  }),
  correlation: Object.freeze({
    pair: Object.freeze({ ...DEFAULT_PANEL_CONTROLS.vectorscopePair }),
    mode: DEFAULT_PANEL_CONTROLS.vectorscopeMode,
    polarLevelPeakHold: DEFAULT_PANEL_CONTROLS.vectorscopePolarLevelPeakHold,
  }),
  stats: Object.freeze({
    statsVisibleIds: Object.freeze([...DEFAULT_DOCK_STATS_VISIBLE_IDS]),
    statsOrder: Object.freeze([...DEFAULT_DOCK_STATS_ORDER]),
  }),
  spectrogram: Object.freeze({
    channel: Object.freeze({ ...DEFAULT_PANEL_CONTROLS.spectrumChannel }),
    minFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMinFreq,
    maxFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMaxFreq,
  }),
});

export const DOCK_CONTROL_MODULE_IDS = Object.freeze(
  Object.keys(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID)
);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value, min, max, fallback) {
  return finite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function pair(raw, fallback) {
  if (finite(raw?.x) && finite(raw?.y) && raw.x >= 0 && raw.y >= 0 && raw.x !== raw.y) {
    return { x: Math.floor(raw.x), y: Math.floor(raw.y) };
  }
  return { ...fallback };
}

function channel(raw, fallback) {
  if (raw?.type === "single" && finite(raw.ch) && raw.ch >= 0) {
    return { type: "single", ch: Math.floor(raw.ch) };
  }
  if (
    raw?.type === "pair" &&
    finite(raw.x) &&
    finite(raw.y) &&
    raw.x >= 0 &&
    raw.y >= 0 &&
    raw.x !== raw.y
  ) {
    return { type: "pair", x: Math.floor(raw.x), y: Math.floor(raw.y) };
  }
  return { ...fallback };
}

function linearRange(rawMin, rawMax, fallbackMin, fallbackMax, absMin, absMax, minSpan) {
  let min = clamp(rawMin, absMin, absMax, fallbackMin);
  let max = clamp(rawMax, absMin, absMax, fallbackMax);
  if (max - min < minSpan) {
    min = fallbackMin;
    max = fallbackMax;
  }
  return { min, max };
}

function logRange(rawMin, rawMax, fallbackMin, fallbackMax) {
  let min = clamp(rawMin, 20, 20000, fallbackMin);
  let max = clamp(rawMax, 20, 20000, fallbackMax);
  if (max <= min || Math.log2(max / min) < 1) {
    min = fallbackMin;
    max = fallbackMax;
  }
  return { min, max };
}

export function normalizeDockStatsVisibleIds(raw) {
  const fallback = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.statsVisibleIds;
  if (!Array.isArray(raw)) return [...fallback];
  const ids = [];
  for (const id of raw) {
    if (STATS_CANONICAL_ORDER.includes(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function normalizeDockStatsOrder(raw) {
  const ordered = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (STATS_CANONICAL_ORDER.includes(id) && !ordered.includes(id)) ordered.push(id);
    }
  }
  for (const id of DEFAULT_DOCK_STATS_ORDER) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

function normalizeDockLoudnessLayerIds(raw) {
  const fallback = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness.loudnessHistoryVisibleLayerIds;
  if (!Array.isArray(raw)) return [...fallback];
  return raw.filter((id, index) => LOUDNESS_HISTORY_LAYER_IDS.has(id) && raw.indexOf(id) === index);
}

export function normalizeDockModuleControls(moduleId, raw) {
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults) return null;

  switch (moduleId) {
    case "level": {
      const mode = LEVEL_MODES.has(raw?.mode) ? raw.mode : defaults.mode;
      const legacyReadout = raw?.readout === "peak" ? "live" : raw?.readout;
      let readout = LEVEL_READOUTS.has(legacyReadout) ? legacyReadout : defaults.readout;
      if (mode === "peak" && readout === "playbackMax") readout = "live";
      if (mode !== "peak" && readout === "truePeakMax") readout = "live";
      return {
        mode,
        readout,
        showLabels: bool(raw?.showLabels, bool(raw?.showChannelLabels, defaults.showLabels)),
      };
    }
    case "loudness": {
      const range = linearRange(
        raw?.loudnessYMinDb,
        raw?.loudnessYMaxDb,
        defaults.loudnessYMinDb,
        defaults.loudnessYMaxDb,
        -64,
        0,
        12
      );
      return {
        showReadouts: bool(raw?.showReadouts, defaults.showReadouts),
        loudnessReferenceLufs: normalizeReferenceLufs(
          raw?.loudnessReferenceLufs ?? raw?.referenceLufs
        ),
        loudnessHistoryVisibleLayerIds: normalizeDockLoudnessLayerIds(
          raw?.loudnessHistoryVisibleLayerIds
        ),
        loudnessYMinDb: range.min,
        loudnessYMaxDb: range.max,
      };
    }
    case "spectrum": {
      const range = linearRange(
        raw?.minDb,
        raw?.maxDb,
        defaults.minDb,
        defaults.maxDb,
        -120,
        0,
        12
      );
      const freqRange = logRange(raw?.minFreq, raw?.maxFreq, defaults.minFreq, defaults.maxFreq);
      return {
        channel: channel(raw?.channel, defaults.channel),
        view: SPECTRUM_VIEWS.has(raw?.view) ? raw.view : defaults.view,
        speedPercent: Math.round(
          clamp(raw?.speedPercent ?? raw?.smoothingPercent, 0, 100, defaults.speedPercent)
        ),
        octaveSmoothing: SPECTRUM_OCTAVE_SMOOTHING_IDS.has(raw?.octaveSmoothing)
          ? raw.octaveSmoothing
          : defaults.octaveSmoothing,
        tiltDbPerOctave: clamp(raw?.tiltDbPerOctave, 0, 6, defaults.tiltDbPerOctave),
        maxHold: bool(raw?.maxHold ?? raw?.peakHold, defaults.maxHold),
        minFreq: freqRange.min,
        maxFreq: freqRange.max,
        minDb: range.min,
        maxDb: range.max,
      };
    }
    case "correlation":
      return {
        pair: pair(raw?.pair, defaults.pair),
        mode: VECTORSCOPE_MODES.has(raw?.mode) ? raw.mode : defaults.mode,
        polarLevelPeakHold: bool(raw?.polarLevelPeakHold, defaults.polarLevelPeakHold),
      };
    case "stats":
      return {
        statsVisibleIds: normalizeDockStatsVisibleIds(raw?.statsVisibleIds),
        statsOrder: normalizeDockStatsOrder(raw?.statsOrder),
      };
    case "spectrogram": {
      const freqRange = logRange(raw?.minFreq, raw?.maxFreq, defaults.minFreq, defaults.maxFreq);
      return {
        channel: channel(raw?.channel, defaults.channel),
        minFreq: freqRange.min,
        maxFreq: freqRange.max,
      };
    }
    default:
      return null;
  }
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
