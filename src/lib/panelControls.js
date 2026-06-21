import { STATS_META, STATS_CANONICAL_ORDER, STATS_OPTIONS } from "./statsCatalog.js";

export const LOUDNESS_STATS_META = STATS_META;
export const LOUDNESS_STATS_ORDER = STATS_CANONICAL_ORDER;
export const LOUDNESS_STATS_OPTIONS = STATS_OPTIONS;

export const LOUDNESS_HISTORY_LAYER_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "ref", label: "Reference" },
];

export const LEVEL_METER_MODE_OPTIONS = [
  { id: "peak", label: "Peak" },
  { id: "momentary", label: "M" },
  { id: "shortTerm", label: "ST" },
];

export const DEFAULT_PANEL_CONTROLS = {
  levelMeterMode: "peak",
  vectorscopePair: { x: 0, y: 1 },
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  spectrumView: "combined",
  spectrumPeakHold: false,
  loudnessStatsVisibleIds: [
    "momentary",
    "shortTerm",
    "integrated",
    "momentaryMax",
    "shortTermMax",
    "lra",
    "psr",
    "plr",
  ],
  loudnessStatsOrder: [...LOUDNESS_STATS_ORDER],
  loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
};

const LOUDNESS_STATS_IDS = new Set(LOUDNESS_STATS_OPTIONS.map((option) => option.id));
const LOUDNESS_HISTORY_LAYER_IDS = new Set(
  LOUDNESS_HISTORY_LAYER_OPTIONS.map((option) => option.id)
);
const LEVEL_METER_MODE_IDS = new Set(LEVEL_METER_MODE_OPTIONS.map((option) => option.id));

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePair(raw, fallback) {
  if (raw && isNumber(raw.x) && isNumber(raw.y)) {
    return { x: raw.x, y: raw.y };
  }
  return { ...fallback };
}

function normalizeSpectrumChannel(raw) {
  if (raw?.type === "single" && isNumber(raw.ch)) {
    return { type: "single", ch: raw.ch };
  }
  if (raw?.type === "pair" && isNumber(raw.x) && isNumber(raw.y)) {
    return { type: "pair", x: raw.x, y: raw.y };
  }
  return { ...DEFAULT_PANEL_CONTROLS.spectrumChannel };
}

const SPECTRUM_VIEWS = new Set(["combined", "lr", "ms"]);
function normalizeSpectrumView(raw) {
  return SPECTRUM_VIEWS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.spectrumView;
}

function normalizeSpectrumPeakHold(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrumPeakHold;
}

function normalizeLevelMeterMode(raw) {
  return LEVEL_METER_MODE_IDS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.levelMeterMode;
}

function normalizeKnownIds(raw, knownIds, fallback) {
  if (!Array.isArray(raw)) return [...fallback];

  const normalized = [];
  for (const id of raw) {
    if (knownIds.has(id) && !normalized.includes(id)) {
      normalized.push(id);
    }
  }
  return normalized;
}

function normalizeOrder(raw, orderTemplate) {
  const known = new Set(orderTemplate);
  const ordered = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (known.has(id) && !ordered.includes(id)) {
        ordered.push(id);
      }
    }
  }
  for (const id of orderTemplate) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

export function normalizePanelControls(raw) {
  return {
    levelMeterMode: normalizeLevelMeterMode(raw?.levelMeterMode),
    vectorscopePair: normalizePair(raw?.vectorscopePair, DEFAULT_PANEL_CONTROLS.vectorscopePair),
    spectrumChannel: normalizeSpectrumChannel(raw?.spectrumChannel),
    spectrumView: normalizeSpectrumView(raw?.spectrumView),
    spectrumPeakHold: normalizeSpectrumPeakHold(raw?.spectrumPeakHold),
    loudnessStatsVisibleIds: normalizeKnownIds(
      raw?.loudnessStatsVisibleIds,
      LOUDNESS_STATS_IDS,
      DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds
    ),
    loudnessStatsOrder: normalizeOrder(raw?.loudnessStatsOrder, LOUDNESS_STATS_ORDER),
    loudnessHistoryVisibleLayerIds: normalizeKnownIds(
      raw?.loudnessHistoryVisibleLayerIds,
      LOUDNESS_HISTORY_LAYER_IDS,
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    ),
  };
}
