import { normalizeReferenceLufs } from "../settings/defaults.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

const MAX_STATS_IDS = 4;
const SPECTRUM_VIEWS = new Set(["combined", "lr", "ms"]);
const LOUDNESS_METRICS = new Set(["momentary", "shortTerm", "integrated"]);
const LEVEL_READOUTS = new Set(["truePeakMax", "peak"]);
const WAVEFORM_VIEWS = new Set(["all", "single"]);

export const DEFAULT_DOCK_CONTROLS_BY_MODULE_ID = Object.freeze({
  level: Object.freeze({ readout: "truePeakMax" }),
  loudness: Object.freeze({
    metric: "shortTerm",
    showSparkline: true,
    showReference: false,
    referenceLufs: -23,
  }),
  spectrum: Object.freeze({
    channel: Object.freeze({ type: "pair", x: 0, y: 1 }),
    view: "combined",
    smoothingPercent: 25,
    tiltDbPerOctave: 3,
    peakHold: false,
    minDb: -96,
    maxDb: -12,
  }),
  correlation: Object.freeze({ pair: Object.freeze({ x: 0, y: 1 }), showValue: true }),
  stats: Object.freeze({ ids: Object.freeze(["integrated", "truePeak", "lra"]) }),
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

export function normalizeDockStatsIds(raw) {
  const fallback = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.ids;
  if (!Array.isArray(raw)) return [...fallback];
  const ids = [];
  for (const id of raw) {
    if (STATS_CANONICAL_ORDER.includes(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_STATS_IDS) break;
  }
  return ids;
}

export function normalizeDockModuleControls(moduleId, raw) {
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults) return null;

  switch (moduleId) {
    case "level":
      return { readout: LEVEL_READOUTS.has(raw?.readout) ? raw.readout : defaults.readout };
    case "loudness":
      return {
        metric: LOUDNESS_METRICS.has(raw?.metric) ? raw.metric : defaults.metric,
        showSparkline: bool(raw?.showSparkline, defaults.showSparkline),
        showReference: bool(raw?.showReference, defaults.showReference),
        referenceLufs: normalizeReferenceLufs(raw?.referenceLufs),
      };
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
      return {
        channel: channel(raw?.channel, defaults.channel),
        view: SPECTRUM_VIEWS.has(raw?.view) ? raw.view : defaults.view,
        smoothingPercent: Math.round(
          clamp(raw?.smoothingPercent, 0, 100, defaults.smoothingPercent)
        ),
        tiltDbPerOctave: clamp(raw?.tiltDbPerOctave, 0, 6, defaults.tiltDbPerOctave),
        peakHold: bool(raw?.peakHold, defaults.peakHold),
        minDb: range.min,
        maxDb: range.max,
      };
    }
    case "correlation":
      return {
        pair: pair(raw?.pair, defaults.pair),
        showValue: bool(raw?.showValue, defaults.showValue),
      };
    case "stats":
      return { ids: normalizeDockStatsIds(raw?.ids) };
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

export function normalizeDockControlsByModuleId(raw, legacyStatsIds) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    DOCK_CONTROL_MODULE_IDS.map((moduleId) => [
      moduleId,
      normalizeDockModuleControls(
        moduleId,
        moduleId === "stats" && source.stats == null && legacyStatsIds !== undefined
          ? { ids: legacyStatsIds }
          : source[moduleId]
      ),
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
