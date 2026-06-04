import { UI_PREFERENCES } from "../uiPreferences.js";

export const LOUDNESS_STATS_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "integrated", label: "Integrated" },
  { id: "momentaryMax", label: "Momentary max" },
  { id: "shortTermMax", label: "Short-term max" },
  { id: "lra", label: "LRA" },
  { id: "psr", label: "PSR" },
  { id: "plr", label: "PLR" },
];

export const LOUDNESS_HISTORY_LAYER_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "ref", label: "Reference" },
];

export const DEFAULT_PANEL_CONTROLS = {
  vectorscopePair: { x: 0, y: 1 },
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  loudnessStatsVisibleIds: ["momentary", "shortTerm", "integrated", "lra"],
  loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
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

export function normalizePanelControls(raw) {
  return {
    vectorscopePair: normalizePair(raw?.vectorscopePair, DEFAULT_PANEL_CONTROLS.vectorscopePair),
    spectrumChannel: normalizeSpectrumChannel(raw?.spectrumChannel),
    loudnessStatsVisibleIds: normalizeKnownIds(
      raw?.loudnessStatsVisibleIds,
      LOUDNESS_STATS_IDS,
      DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds
    ),
    loudnessHistoryVisibleLayerIds: normalizeKnownIds(
      raw?.loudnessHistoryVisibleLayerIds,
      LOUDNESS_HISTORY_LAYER_IDS,
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    ),
  };
}

export function readPersistedPanelControls(prefs = UI_PREFERENCES) {
  try {
    const raw = localStorage.getItem(prefs.layoutPersistKey);
    if (!raw) return normalizePanelControls();

    const parsed = JSON.parse(raw);
    return normalizePanelControls(parsed?.panelControls);
  } catch (_) {
    return normalizePanelControls();
  }
}

export function writePersistedPanelControls(panelControls, prefs = UI_PREFERENCES) {
  let persisted = {};

  try {
    const raw = localStorage.getItem(prefs.layoutPersistKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        persisted = parsed;
      }
    }
  } catch (_) {}

  localStorage.setItem(
    prefs.layoutPersistKey,
    JSON.stringify({
      ...persisted,
      panelControls: normalizePanelControls(panelControls),
    })
  );
}
