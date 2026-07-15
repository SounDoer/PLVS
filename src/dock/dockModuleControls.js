import { normalizeReferenceLufs } from "../settings/defaults.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
import { LOUDNESS_HISTORY_LAYER_OPTIONS } from "../lib/panelControls.js";

const SPECTRUM_VIEWS = new Set(["combined", "lr", "ms"]);
const LOUDNESS_HISTORY_LAYER_IDS = new Set(
  LOUDNESS_HISTORY_LAYER_OPTIONS.map((option) => option.id)
);
const LEVEL_MODES = new Set(["peak", "rms", "momentary", "shortTerm"]);
const LEVEL_READOUTS = new Set(["live", "truePeakMax", "playbackMax"]);
const WAVEFORM_VIEWS = new Set(["all", "single"]);
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

const DEFAULT_DOCK_STATS_VISIBLE_IDS = ["integrated", "truePeak", "lra"];
const DEFAULT_DOCK_STATS_ORDER = [
  ...DEFAULT_DOCK_STATS_VISIBLE_IDS,
  ...STATS_CANONICAL_ORDER.filter((id) => !DEFAULT_DOCK_STATS_VISIBLE_IDS.includes(id)),
];

export const DEFAULT_DOCK_CONTROLS_BY_MODULE_ID = Object.freeze({
  level: Object.freeze({ mode: "peak", readout: "live", showLabels: true }),
  loudness: Object.freeze({
    loudnessReferenceLufs: -23,
    loudnessHistoryVisibleLayerIds: Object.freeze(["momentary", "shortTerm", "ref"]),
    loudnessYMinDb: -64,
    loudnessYMaxDb: 0,
  }),
  spectrum: Object.freeze({
    channel: Object.freeze({ type: "pair", x: 0, y: 1 }),
    view: "combined",
    smoothingPercent: 25,
    tiltDbPerOctave: 3,
    peakHold: false,
    minFreq: 20,
    maxFreq: 20000,
    minDb: -96,
    maxDb: -12,
  }),
  correlation: Object.freeze({ pair: Object.freeze({ x: 0, y: 1 }) }),
  stats: Object.freeze({
    statsVisibleIds: Object.freeze([...DEFAULT_DOCK_STATS_VISIBLE_IDS]),
    statsOrder: Object.freeze([...DEFAULT_DOCK_STATS_ORDER]),
  }),
  waveform: Object.freeze({ view: "all", channel: 0, windowSec: 30 }),
  spectrogram: Object.freeze({
    channel: Object.freeze({ type: "pair", x: 0, y: 1 }),
    minDb: -96,
    maxDb: -12,
    minFreq: 20,
    maxFreq: 20000,
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
        smoothingPercent: Math.round(
          clamp(raw?.smoothingPercent, 0, 100, defaults.smoothingPercent)
        ),
        tiltDbPerOctave: clamp(raw?.tiltDbPerOctave, 0, 6, defaults.tiltDbPerOctave),
        peakHold: bool(raw?.peakHold, defaults.peakHold),
        minFreq: freqRange.min,
        maxFreq: freqRange.max,
        minDb: range.min,
        maxDb: range.max,
      };
    }
    case "correlation":
      return {
        pair: pair(raw?.pair, defaults.pair),
      };
    case "stats":
      return {
        statsVisibleIds: normalizeDockStatsVisibleIds(raw?.statsVisibleIds),
        statsOrder: normalizeDockStatsOrder(raw?.statsOrder),
      };
    case "waveform":
      return {
        view: WAVEFORM_VIEWS.has(raw?.view) ? raw.view : defaults.view,
        channel: Math.floor(clamp(raw?.channel, 0, 63, defaults.channel)),
        windowSec: Math.round(clamp(raw?.windowSec, 5, 120, defaults.windowSec)),
      };
    case "spectrogram": {
      const dbRange = linearRange(
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
        minDb: dbRange.min,
        maxDb: dbRange.max,
        minFreq: freqRange.min,
        maxFreq: freqRange.max,
      };
    }
    default:
      return null;
  }
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
