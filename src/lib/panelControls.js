import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "./statsCatalog.js";
import { DEFAULT_DIALOGUE_VAD_ENGINE, normalizeDialogueVadEngine } from "./dialogueVadEngines.js";
import { normalizeReferenceLufs } from "../settings/defaults.js";

export const LOUDNESS_HISTORY_LAYER_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "ref", label: "Reference" },
];

export const LEVEL_METER_MODE_OPTIONS = [
  { id: "peak", label: "Peak" },
  { id: "rms", label: "RMS" },
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
];

/// Frequency-axis smoothing. Distinct from Speed, which is the time axis. Ids are the wire
/// values parsed by `parse_octave_smoothing` in src-tauri/src/ipc/commands.rs.
export const SPECTRUM_OCTAVE_SMOOTHING_OPTIONS = [
  { id: "off", label: "Off", keyToken: "off" },
  { id: "1/12", label: "1/12 oct", keyToken: "12" },
  { id: "1/6", label: "1/6 oct", keyToken: "6" },
  { id: "1/3", label: "1/3 oct", keyToken: "3" },
];

export const DEFAULT_PANEL_CONTROLS = {
  levelMeterMode: "peak",
  levelMeterPlaybackMax: false,
  levelMeterValueMarker: false,
  levelMeterTpMaxMarker: false,
  vectorscopePair: { x: 0, y: 1 },
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  spectrumView: "combined",
  spectrumMaxHold: false,
  spectrumSpeedPercent: 25,
  spectrumTiltDbPerOctave: 3,
  spectrumOctaveSmoothing: "off",
  spectrumXMinFreq: 20,
  spectrumXMaxFreq: 20000,
  spectrumYMaxDb: -12,
  spectrumYMinDb: -96,
  spectrogramYMinFreq: 20,
  spectrogramYMaxFreq: 20000,
  loudnessReferenceLufs: -23,
  loudnessYMinDb: -64,
  loudnessYMaxDb: 0,
  levelMeterYMinDb: -60,
  levelMeterYMaxDb: 3,
  statsVisibleIds: [
    "momentary",
    "shortTerm",
    "integrated",
    "momentaryMax",
    "shortTermMax",
    "lra",
    "psr",
    "plr",
  ],
  statsOrder: [...STATS_CANONICAL_ORDER],
  dialogueVadEngine: DEFAULT_DIALOGUE_VAD_ENGINE,
  loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
};

const STATS_IDS = new Set(STATS_OPTIONS.map((option) => option.id));
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

const SPECTRUM_OCTAVE_SMOOTHING_IDS = new Set(
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS.map((option) => option.id)
);
function normalizeSpectrumOctaveSmoothing(raw) {
  return SPECTRUM_OCTAVE_SMOOTHING_IDS.has(raw)
    ? raw
    : DEFAULT_PANEL_CONTROLS.spectrumOctaveSmoothing;
}

function normalizeSpectrumMaxHold(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrumMaxHold;
}

/// spectrumMaxHold was spectrumPeakHold until "peak" was needed for the frequency axis — a peak
/// in a spectrum is a bump in the curve, which is what Peak labels marks; this control is the
/// time axis. Presets from before the rename still carry the old key, so read it as a fallback
/// rather than snapping them back to the default. `??` and not `||`: a stored `false` is a real
/// value, not an absent one.
function readSpectrumMaxHoldRaw(raw) {
  return raw?.spectrumMaxHold ?? raw?.spectrumPeakHold;
}

function clampNumber(raw, min, max, fallback) {
  if (!isNumber(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function normalizeSpectrumSpeedPercent(raw) {
  return clampNumber(raw, 0, 100, DEFAULT_PANEL_CONTROLS.spectrumSpeedPercent);
}

function normalizeSpectrumTiltDbPerOctave(raw) {
  return clampNumber(raw, 0, 6, DEFAULT_PANEL_CONTROLS.spectrumTiltDbPerOctave);
}

function normalizeLinearRange({ rawMin, rawMax, defaultMin, defaultMax, absMin, absMax, minSpan }) {
  let min = Math.round(clampNumber(rawMin, absMin, absMax, defaultMin));
  let max = Math.round(clampNumber(rawMax, absMin, absMax, defaultMax));
  if (max - min < minSpan) {
    if (isNumber(rawMax) && !isNumber(rawMin)) {
      min = Math.max(absMin, max - minSpan);
    } else {
      max = Math.min(absMax, min + minSpan);
      if (max - min < minSpan) min = Math.max(absMin, max - minSpan);
    }
  }
  return { min, max };
}

function normalizeLogRange({ rawMin, rawMax, defaultMin, defaultMax, absMin, absMax, minOctaves }) {
  let min = clampNumber(rawMin, absMin, absMax, defaultMin);
  let max = clampNumber(rawMax, absMin, absMax, defaultMax);
  if (max <= min || Math.log2(max / min) < minOctaves) {
    if (isNumber(rawMax) && !isNumber(rawMin)) {
      min = Math.max(absMin, max / 2 ** minOctaves);
    } else {
      max = Math.min(absMax, min * 2 ** minOctaves);
      if (Math.log2(max / min) < minOctaves) min = Math.max(absMin, max / 2 ** minOctaves);
    }
  }
  return { min, max };
}

function normalizeSpectrumYRange(raw) {
  const rawMax = raw?.spectrumYMaxDb;
  const migratedMin =
    isNumber(raw?.spectrumYMinDb) || !isNumber(raw?.spectrumYRangeDb)
      ? raw?.spectrumYMinDb
      : clampNumber(rawMax, -120, 0, DEFAULT_PANEL_CONTROLS.spectrumYMaxDb) -
        clampNumber(raw.spectrumYRangeDb, 12, 126, 84);
  return normalizeLinearRange({
    rawMin: migratedMin,
    rawMax,
    defaultMin: DEFAULT_PANEL_CONTROLS.spectrumYMinDb,
    defaultMax: DEFAULT_PANEL_CONTROLS.spectrumYMaxDb,
    absMin: -120,
    absMax: 0,
    minSpan: 12,
  });
}

function normalizeLevelMeterMode(raw) {
  return LEVEL_METER_MODE_IDS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.levelMeterMode;
}

function normalizeLevelMeterValueMarker(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.levelMeterValueMarker;
}

function normalizeLevelMeterPlaybackMax(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.levelMeterPlaybackMax;
}

function normalizeLevelMeterTpMaxMarker(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.levelMeterTpMaxMarker;
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
  const spectrumXRange = normalizeLogRange({
    rawMin: raw?.spectrumXMinFreq,
    rawMax: raw?.spectrumXMaxFreq,
    defaultMin: DEFAULT_PANEL_CONTROLS.spectrumXMinFreq,
    defaultMax: DEFAULT_PANEL_CONTROLS.spectrumXMaxFreq,
    absMin: 20,
    absMax: 20000,
    minOctaves: 1,
  });
  const spectrumYRange = normalizeSpectrumYRange(raw);
  const spectrogramYRange = normalizeLogRange({
    rawMin: raw?.spectrogramYMinFreq,
    rawMax: raw?.spectrogramYMaxFreq,
    defaultMin: DEFAULT_PANEL_CONTROLS.spectrogramYMinFreq,
    defaultMax: DEFAULT_PANEL_CONTROLS.spectrogramYMaxFreq,
    absMin: 20,
    absMax: 20000,
    minOctaves: 1,
  });
  const loudnessYRange = normalizeLinearRange({
    rawMin: raw?.loudnessYMinDb,
    rawMax: raw?.loudnessYMaxDb,
    defaultMin: DEFAULT_PANEL_CONTROLS.loudnessYMinDb,
    defaultMax: DEFAULT_PANEL_CONTROLS.loudnessYMaxDb,
    absMin: -64,
    absMax: 0,
    minSpan: 12,
  });
  const levelMeterYRange = normalizeLinearRange({
    rawMin: raw?.levelMeterYMinDb,
    rawMax: raw?.levelMeterYMaxDb,
    defaultMin: DEFAULT_PANEL_CONTROLS.levelMeterYMinDb,
    defaultMax: DEFAULT_PANEL_CONTROLS.levelMeterYMaxDb,
    absMin: -60,
    absMax: 3,
    minSpan: 12,
  });
  return {
    levelMeterMode: normalizeLevelMeterMode(raw?.levelMeterMode),
    levelMeterPlaybackMax: normalizeLevelMeterPlaybackMax(raw?.levelMeterPlaybackMax),
    levelMeterValueMarker: normalizeLevelMeterValueMarker(raw?.levelMeterValueMarker),
    levelMeterTpMaxMarker: normalizeLevelMeterTpMaxMarker(raw?.levelMeterTpMaxMarker),
    vectorscopePair: normalizePair(raw?.vectorscopePair, DEFAULT_PANEL_CONTROLS.vectorscopePair),
    spectrumChannel: normalizeSpectrumChannel(raw?.spectrumChannel),
    spectrumView: normalizeSpectrumView(raw?.spectrumView),
    spectrumMaxHold: normalizeSpectrumMaxHold(readSpectrumMaxHoldRaw(raw)),
    // spectrumSpeedPercent was named spectrumSmoothingPercent until the frequency-smoothing
    // control arrived and needed the "smoothing" name. Presets written before the rename still
    // carry the old key; read it as a fallback so they keep their value instead of silently
    // snapping back to the default. Normalizing rewrites the key, so this only has to survive
    // one load per stored preset.
    spectrumSpeedPercent: normalizeSpectrumSpeedPercent(
      raw?.spectrumSpeedPercent ?? raw?.spectrumSmoothingPercent
    ),
    spectrumTiltDbPerOctave: normalizeSpectrumTiltDbPerOctave(raw?.spectrumTiltDbPerOctave),
    spectrumOctaveSmoothing: normalizeSpectrumOctaveSmoothing(raw?.spectrumOctaveSmoothing),
    spectrumXMinFreq: spectrumXRange.min,
    spectrumXMaxFreq: spectrumXRange.max,
    spectrumYMaxDb: spectrumYRange.max,
    spectrumYMinDb: spectrumYRange.min,
    spectrogramYMinFreq: spectrogramYRange.min,
    spectrogramYMaxFreq: spectrogramYRange.max,
    loudnessReferenceLufs: normalizeReferenceLufs(raw?.loudnessReferenceLufs),
    loudnessYMinDb: loudnessYRange.min,
    loudnessYMaxDb: loudnessYRange.max,
    levelMeterYMinDb: levelMeterYRange.min,
    levelMeterYMaxDb: levelMeterYRange.max,
    statsVisibleIds: normalizeKnownIds(
      raw?.statsVisibleIds,
      STATS_IDS,
      DEFAULT_PANEL_CONTROLS.statsVisibleIds
    ),
    statsOrder: normalizeOrder(raw?.statsOrder, STATS_CANONICAL_ORDER),
    dialogueVadEngine: normalizeDialogueVadEngine(raw?.dialogueVadEngine),
    loudnessHistoryVisibleLayerIds: normalizeKnownIds(
      raw?.loudnessHistoryVisibleLayerIds,
      LOUDNESS_HISTORY_LAYER_IDS,
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    ),
  };
}
