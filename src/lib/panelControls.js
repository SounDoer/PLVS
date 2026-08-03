import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "./statsCatalog.js";
import { DEFAULT_DIALOGUE_VAD_ENGINE, normalizeDialogueVadEngine } from "./dialogueVadEngines.js";
import { STEREO_MAP_MODES } from "../math/stereoMapMath.js";
import { SPECTROGRAM_DB_MIN } from "../config/scales.js";

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

export const VECTORSCOPE_MODE_OPTIONS = [
  { id: "lissajous", label: "Lissajous" },
  { id: "polarSample", label: "Polar Sample" },
  { id: "polarLevel", label: "Polar Level" },
];

/// Spectrogram view modes. The 2D/3D prefix is carried in the label because that is the
/// distinction users are choosing between; the ids stay short because they are persisted.
export const SPECTROGRAM_MODE_OPTIONS = [
  { id: "heatmap", label: "2D Heatmap" },
  { id: "lines", label: "3D Lines" },
  { id: "surface", label: "3D Surface" },
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
  vectorscopeMode: "lissajous",
  vectorscopePolarLevelMaxHold: false,
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  spectrumView: "combined",
  spectrumMaxHold: false,
  spectrumPeakLabels: false,
  spectrumSpeedPercent: 25,
  spectrumTiltDbPerOctave: 3,
  spectrumOctaveSmoothing: "off",
  spectrumXMinFreq: 20,
  spectrumXMaxFreq: 20000,
  spectrumYMaxDb: -12,
  spectrumYMinDb: -96,
  spectrogramYMinFreq: 20,
  spectrogramYMaxFreq: 20000,
  spectrogramDbFloor: SPECTROGRAM_DB_MIN,
  spectrogramMode: "heatmap",
  spectrogram3dColorize: true,
  spectrogram3dHeightGain: 1,
  spectrogram3dAzimuthDeg: 135,
  spectrogram3dElevationDeg: 60,
  // Surfaced as "Grid": it draws the floor grid, and "Floor" sat one row below "dB Floor" with no
  // relation to it. The key keeps the old name -- it is persisted, and renaming it would need a
  // migration to buy nothing a reader of this line does not already get.
  spectrogram3dFloor: true,
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
  stereoMapMode: STEREO_MAP_MODES.POSITION,
  stereoMapPair: { first: 0, second: 1 },
  stereoMapHold: false,
  stereoMapSpeedPercent: 50,
  stereoMapOctaveSmoothing: "1/12",
  stereoMapXMinFreq: 20,
  stereoMapXMaxFreq: 20000,
  stereoMapMonoLossYMinDb: -24,
  stereoMapMsRatioYMinDb: -48,
  stereoMapMsRatioYMaxDb: 24,
};

const STATS_IDS = new Set(STATS_OPTIONS.map((option) => option.id));
const LOUDNESS_HISTORY_LAYER_IDS = new Set(
  LOUDNESS_HISTORY_LAYER_OPTIONS.map((option) => option.id)
);
const LEVEL_METER_MODE_IDS = new Set(LEVEL_METER_MODE_OPTIONS.map((option) => option.id));
const VECTORSCOPE_MODE_IDS = new Set(VECTORSCOPE_MODE_OPTIONS.map((option) => option.id));
const SPECTROGRAM_MODE_IDS = new Set(SPECTROGRAM_MODE_OPTIONS.map((option) => option.id));
const STEREO_MAP_MODE_IDS = new Set(Object.values(STEREO_MAP_MODES));

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

function normalizeSpectrumPeakLabels(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrumPeakLabels;
}

function normalizeSpectrumMaxHold(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrumMaxHold;
}

function normalizeSpectrogramDbFloor(raw) {
  return clampNumber(raw, -96, -12, DEFAULT_PANEL_CONTROLS.spectrogramDbFloor);
}

function normalizeSpectrogramMode(raw) {
  return SPECTROGRAM_MODE_IDS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.spectrogramMode;
}

function normalizeSpectrogram3dColorize(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrogram3dColorize;
}

function normalizeSpectrogram3dHeightGain(raw) {
  return clampNumber(raw, 0.3, 3, DEFAULT_PANEL_CONTROLS.spectrogram3dHeightGain);
}

/** Azimuth wraps rather than clamping — spinning past 360 during a drag is legitimate. */
function normalizeSpectrogram3dAzimuthDeg(raw) {
  if (!isNumber(raw)) return DEFAULT_PANEL_CONTROLS.spectrogram3dAzimuthDeg;
  return ((raw % 360) + 360) % 360;
}

/**
 * Elevation is clamped at both ends: at 0 the surface collapses to a line, and past about 85 it
 * degenerates into a skewed top-down view that is strictly worse than the 2D mode.
 */
function normalizeSpectrogram3dElevationDeg(raw) {
  return clampNumber(raw, 5, 85, DEFAULT_PANEL_CONTROLS.spectrogram3dElevationDeg);
}

function normalizeSpectrogram3dFloor(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrogram3dFloor;
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

function normalizeVectorscopeMode(raw) {
  return VECTORSCOPE_MODE_IDS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.vectorscopeMode;
}

function normalizeVectorscopePolarLevelMaxHold(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.vectorscopePolarLevelMaxHold;
}

/// vectorscopePolarLevelMaxHold was vectorscopePolarLevelPeakHold: this hold never decays (it's a
/// running maximum cleared only by reset/Global Clear), unlike Spectrum's decaying "Max Decay",
/// so "peak" was misleading here. Presets from before the rename still carry the old key, so read
/// it as a fallback rather than snapping them back to the default. `??` and not `||`: a stored
/// `false` is a real value, not an absent one.
function readVectorscopePolarLevelMaxHoldRaw(raw) {
  return raw?.vectorscopePolarLevelMaxHold ?? raw?.vectorscopePolarLevelPeakHold;
}

function normalizeStereoMapMode(raw) {
  return STEREO_MAP_MODE_IDS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.stereoMapMode;
}

/// Shape matches `stereoMapRequestKeyFromControls`'s `{ first, second }` channel-index pair, not
/// Vectorscope's `{ x, y }` pair. Only shape/type is validated here; clamping to the pair actually
/// available for the current channel count happens in clampPanelControls.js, same split as
/// vectorscopePair.
function normalizeStereoMapPair(raw, fallback) {
  if (raw && isNumber(raw.first) && isNumber(raw.second)) {
    return { first: raw.first, second: raw.second };
  }
  return { ...fallback };
}

function normalizeStereoMapHold(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.stereoMapHold;
}

function normalizeStereoMapSpeedPercent(raw) {
  return clampNumber(raw, 0, 100, DEFAULT_PANEL_CONTROLS.stereoMapSpeedPercent);
}

function normalizeStereoMapOctaveSmoothing(raw) {
  return SPECTRUM_OCTAVE_SMOOTHING_IDS.has(raw)
    ? raw
    : DEFAULT_PANEL_CONTROLS.stereoMapOctaveSmoothing;
}

function normalizeStereoMapMonoLossYMinDb(raw) {
  return clampNumber(raw, -60, -6, DEFAULT_PANEL_CONTROLS.stereoMapMonoLossYMinDb);
}

/// M/S Ratio's Y range has no minimum span, only the design's "must include 0 dB" constraint: each
/// bound clamps to the panel's absolute limits independently, then a bound that ends up on the
/// wrong side of zero snaps to zero rather than being repaired against the other bound.
function normalizeStereoMapMsRatioYRange(raw) {
  let min = clampNumber(
    raw?.stereoMapMsRatioYMinDb,
    -96,
    48,
    DEFAULT_PANEL_CONTROLS.stereoMapMsRatioYMinDb
  );
  let max = clampNumber(
    raw?.stereoMapMsRatioYMaxDb,
    -96,
    48,
    DEFAULT_PANEL_CONTROLS.stereoMapMsRatioYMaxDb
  );
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  return { min, max };
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
  const stereoMapXRange = normalizeLogRange({
    rawMin: raw?.stereoMapXMinFreq,
    rawMax: raw?.stereoMapXMaxFreq,
    defaultMin: DEFAULT_PANEL_CONTROLS.stereoMapXMinFreq,
    defaultMax: DEFAULT_PANEL_CONTROLS.stereoMapXMaxFreq,
    absMin: 20,
    absMax: 20000,
    minOctaves: 1,
  });
  const stereoMapMsRatioYRange = normalizeStereoMapMsRatioYRange(raw);
  return {
    levelMeterMode: normalizeLevelMeterMode(raw?.levelMeterMode),
    levelMeterPlaybackMax: normalizeLevelMeterPlaybackMax(raw?.levelMeterPlaybackMax),
    levelMeterValueMarker: normalizeLevelMeterValueMarker(raw?.levelMeterValueMarker),
    levelMeterTpMaxMarker: normalizeLevelMeterTpMaxMarker(raw?.levelMeterTpMaxMarker),
    vectorscopePair: normalizePair(raw?.vectorscopePair, DEFAULT_PANEL_CONTROLS.vectorscopePair),
    vectorscopeMode: normalizeVectorscopeMode(raw?.vectorscopeMode),
    vectorscopePolarLevelMaxHold: normalizeVectorscopePolarLevelMaxHold(
      readVectorscopePolarLevelMaxHoldRaw(raw)
    ),
    spectrumChannel: normalizeSpectrumChannel(raw?.spectrumChannel),
    spectrumView: normalizeSpectrumView(raw?.spectrumView),
    spectrumMaxHold: normalizeSpectrumMaxHold(readSpectrumMaxHoldRaw(raw)),
    spectrumPeakLabels: normalizeSpectrumPeakLabels(raw?.spectrumPeakLabels),
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
    spectrogramDbFloor: normalizeSpectrogramDbFloor(raw?.spectrogramDbFloor),
    spectrogramMode: normalizeSpectrogramMode(raw?.spectrogramMode),
    spectrogram3dColorize: normalizeSpectrogram3dColorize(raw?.spectrogram3dColorize),
    spectrogram3dHeightGain: normalizeSpectrogram3dHeightGain(raw?.spectrogram3dHeightGain),
    spectrogram3dAzimuthDeg: normalizeSpectrogram3dAzimuthDeg(raw?.spectrogram3dAzimuthDeg),
    spectrogram3dElevationDeg: normalizeSpectrogram3dElevationDeg(raw?.spectrogram3dElevationDeg),
    spectrogram3dFloor: normalizeSpectrogram3dFloor(raw?.spectrogram3dFloor),
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
    stereoMapMode: normalizeStereoMapMode(raw?.stereoMapMode),
    stereoMapPair: normalizeStereoMapPair(raw?.stereoMapPair, DEFAULT_PANEL_CONTROLS.stereoMapPair),
    stereoMapHold: normalizeStereoMapHold(raw?.stereoMapHold),
    stereoMapSpeedPercent: normalizeStereoMapSpeedPercent(raw?.stereoMapSpeedPercent),
    stereoMapOctaveSmoothing: normalizeStereoMapOctaveSmoothing(raw?.stereoMapOctaveSmoothing),
    stereoMapXMinFreq: stereoMapXRange.min,
    stereoMapXMaxFreq: stereoMapXRange.max,
    stereoMapMonoLossYMinDb: normalizeStereoMapMonoLossYMinDb(raw?.stereoMapMonoLossYMinDb),
    stereoMapMsRatioYMinDb: stereoMapMsRatioYRange.min,
    stereoMapMsRatioYMaxDb: stereoMapMsRatioYRange.max,
  };
}
