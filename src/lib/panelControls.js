import { UI_PREFERENCES } from "../uiPreferences.js";
import { patchUiState, readUiState } from "../preferences/uiStore.js";

export const LOUDNESS_STATS_META = {
  momentary: { label: "Momentary", unit: "LUFS", hint: "Loudness over a 400ms window" },
  shortTerm: { label: "Short-term", unit: "LUFS", hint: "Loudness over a 3s window" },
  integrated: {
    label: "Integrated",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  momentaryMax: {
    label: "Momentary Max",
    unit: "LUFS",
    hint: "Highest Momentary (400ms) loudness reached so far",
  },
  shortTermMax: {
    label: "Short-term Max",
    unit: "LUFS",
    hint: "Highest Short-term (3s) loudness reached so far",
  },
  lra: { label: "Loudness Range", unit: "LU", hint: "LRA, loudness range over the whole program" },
  psr: { label: "Short-term Dynamics", unit: "dB", hint: "PSR, Peak to Short-term loudness Ratio" },
  plr: { label: "Integrated Dynamics", unit: "dB", hint: "PLR, Peak to Loudness Ratio" },
  dialogueCoverage: {
    label: "Dialogue Coverage",
    unit: "%",
    hint: "Share of time dialogue is detected",
  },
  dialogueIntegrated: {
    label: "Dialogue Integrated",
    unit: "LUFS",
    hint: "Loudness over dialogue only",
  },
  dialogueRange: { label: "Dialogue Range", unit: "LU", hint: "Loudness range over dialogue only" },
  dialogueOffset: {
    label: "Dialogue Offset",
    unit: "LU",
    hint: "Dialogue loudness relative to the overall mix",
  },
};

export const LOUDNESS_STATS_ORDER = [
  "momentary",
  "shortTerm",
  "integrated",
  "momentaryMax",
  "shortTermMax",
  "lra",
  "psr",
  "plr",
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
];

export const LOUDNESS_STATS_OPTIONS = LOUDNESS_STATS_ORDER.map((id) => ({
  id,
  label: LOUDNESS_STATS_META[id].label,
  hint: LOUDNESS_STATS_META[id].hint,
}));

export const LOUDNESS_HISTORY_LAYER_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "ref", label: "Reference" },
];

export const DEFAULT_PANEL_CONTROLS = {
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

export function readPersistedPanelControls(prefs = UI_PREFERENCES) {
  return normalizePanelControls(readUiState(prefs)?.panelControls);
}

export function writePersistedPanelControls(panelControls, prefs = UI_PREFERENCES) {
  patchUiState({ panelControls: normalizePanelControls(panelControls) }, prefs);
}
