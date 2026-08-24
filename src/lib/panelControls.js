import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "./statsCatalog.js";
import { DEFAULT_DIALOGUE_VAD_ENGINE, normalizeDialogueVadEngine } from "./dialogueVadEngines.js";
import { STEREO_MAP_MODES } from "../math/stereoMapMath.js";
import {
  ELEVATION_MAX_DEG,
  ELEVATION_MIN_DEG,
  HEIGHT_GAIN_MAX,
  HEIGHT_GAIN_MIN,
} from "../math/spectrogram3dProjection.js";
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

const SPECTRUM_VIEW_IDS = ["combined", "lr", "ms"];

function ids(options) {
  return options.map((option) => option.id);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clampNumber(raw, min, max, fallback) {
  if (!isNumber(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// ---------------------------------------------------------------------------
// The control table
//
// One row per persisted control: its default, the rule that repairs a stored
// value, and any key it used to be stored under. Everything that has an opinion
// about a control's range says it here and only here -- the dock and the panel
// axes read the row rather than restating the numbers, which is what they used
// to do (three copies of `-120, 0, 12` for the Spectrum dB range alone).
//
// `kind` picks the repair rule from KINDS below; a row that needs something no
// kind covers carries its own `normalize`. Row order is the key order of both
// DEFAULT_PANEL_CONTROLS and normalizePanelControls' output.
// ---------------------------------------------------------------------------

/** Reads a control's stored value, falling back to the keys it used to live under. */
function readStored(raw, row) {
  let value = raw?.[row.key];
  for (const legacyKey of row.legacyKeys ?? []) {
    value = value ?? raw?.[legacyKey];
  }
  return value;
}

const KINDS = {
  /** One of a fixed id list; anything else falls back to the default. */
  enum(row, raw) {
    const value = readStored(raw, row);
    return row.options.includes(value) ? value : row.default;
  },

  boolean(row, raw) {
    const value = readStored(raw, row);
    return typeof value === "boolean" ? value : row.default;
  },

  number(row, raw) {
    const value = clampNumber(readStored(raw, row), row.min, row.max, row.default);
    return row.round ? Math.round(value) : value;
  },

  /** Wraps into [0, 360) rather than clamping -- spinning past 360 in a drag is legitimate. */
  degrees(row, raw) {
    const value = readStored(raw, row);
    if (!isNumber(value)) return row.default;
    return ((value % 360) + 360) % 360;
  },

  /** A channel-index pair. `members` names the two fields, which differ per control. */
  pair(row, raw) {
    const value = readStored(raw, row);
    const [first, second] = row.members;
    if (value && isNumber(value[first]) && isNumber(value[second])) {
      return { [first]: value[first], [second]: value[second] };
    }
    return { ...row.default };
  },

  /** A subset of known ids, deduped, unknown ids dropped, order as stored. */
  idList(row, raw) {
    const value = readStored(raw, row);
    if (!Array.isArray(value)) return [...row.default];
    const normalized = [];
    for (const id of value) {
      if (row.options.includes(id) && !normalized.includes(id)) normalized.push(id);
    }
    return normalized;
  },

  /** Every known id exactly once: stored order first, then the template backfills the rest. */
  orderedIdList(row, raw) {
    const value = readStored(raw, row);
    const ordered = [];
    if (Array.isArray(value)) {
      for (const id of value) {
        if (row.options.includes(id) && !ordered.includes(id)) ordered.push(id);
      }
    }
    for (const id of row.options) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  },
};

/**
 * Repairs a min/max pair together: each bound clamps to the row's absolute limits, then the pair
 * is opened up to the row's minimum span. Which bound moves depends on which one the caller
 * actually supplied -- a stored max with no min means the min is the one to move.
 */
function normalizeRange(row, raw) {
  const rawMin = readStored(raw, { key: row.minKey, legacyKeys: row.minLegacyKeys });
  const rawMax = readStored(raw, { key: row.maxKey, legacyKeys: row.maxLegacyKeys });
  const log = row.kind === "logRange";
  const round = (value) => (log ? value : Math.round(value));
  const openUp = (value) => (log ? value * 2 ** row.minSpan : value + row.minSpan);
  const openDown = (value) => (log ? value / 2 ** row.minSpan : value - row.minSpan);
  const tooNarrow = (min, max) =>
    log ? max <= min || Math.log2(max / min) < row.minSpan : max - min < row.minSpan;

  let min = round(clampNumber(rawMin, row.absMin, row.absMax, row.defaultMin));
  let max = round(clampNumber(rawMax, row.absMin, row.absMax, row.defaultMax));
  if (tooNarrow(min, max)) {
    if (isNumber(rawMax) && !isNumber(rawMin)) {
      min = Math.max(row.absMin, openDown(max));
    } else {
      max = Math.min(row.absMax, openUp(min));
      if (tooNarrow(min, max)) min = Math.max(row.absMin, openDown(max));
    }
  }
  return { [row.minKey]: min, [row.maxKey]: max };
}

const CONTROLS = [
  {
    key: "levelMeterMode",
    kind: "enum",
    options: ids(LEVEL_METER_MODE_OPTIONS),
    default: "peak",
  },
  { key: "levelMeterPlaybackMax", kind: "boolean", default: false },
  { key: "levelMeterValueMarker", kind: "boolean", default: false },
  { key: "levelMeterTpMaxMarker", kind: "boolean", default: false },
  {
    key: "vectorscopePair",
    kind: "pair",
    members: ["x", "y"],
    default: { x: 0, y: 1 },
  },
  {
    key: "vectorscopeMode",
    kind: "enum",
    options: ids(VECTORSCOPE_MODE_OPTIONS),
    default: "lissajous",
  },
  {
    /// vectorscopePolarLevelMaxHold was vectorscopePolarLevelPeakHold: this hold never decays
    /// (it's a running maximum cleared only by reset/Global Clear), unlike Spectrum's decaying
    /// "Max Decay", so "peak" was misleading here. Presets from before the rename still carry the
    /// old key, so read it as a fallback rather than snapping them back to the default. The
    /// fallback is `??` and not `||`: a stored `false` is a real value, not an absent one.
    key: "vectorscopePolarLevelMaxHold",
    kind: "boolean",
    default: false,
    legacyKeys: ["vectorscopePolarLevelPeakHold"],
  },
  {
    key: "spectrumChannel",
    default: { type: "pair", x: 0, y: 1 },
    normalize(row, raw) {
      const value = readStored(raw, row);
      if (value?.type === "single" && isNumber(value.ch)) return { type: "single", ch: value.ch };
      if (value?.type === "pair" && isNumber(value.x) && isNumber(value.y)) {
        return { type: "pair", x: value.x, y: value.y };
      }
      return { ...row.default };
    },
  },
  { key: "spectrumView", kind: "enum", options: SPECTRUM_VIEW_IDS, default: "combined" },
  {
    /// spectrumMaxHold was spectrumPeakHold until "peak" was needed for the frequency axis -- a
    /// peak in a spectrum is a bump in the curve, which is what Peak labels marks; this control is
    /// the time axis. Presets from before the rename still carry the old key.
    key: "spectrumMaxHold",
    kind: "boolean",
    default: false,
    legacyKeys: ["spectrumPeakHold"],
  },
  { key: "spectrumPeakLabels", kind: "boolean", default: false },
  {
    /// spectrumSpeedPercent was named spectrumSmoothingPercent until the frequency-smoothing
    /// control arrived and needed the "smoothing" name. Presets written before the rename still
    /// carry the old key; normalizing rewrites it, so this only has to survive one load per
    /// stored preset.
    key: "spectrumSpeedPercent",
    kind: "number",
    min: 0,
    max: 100,
    default: 25,
    legacyKeys: ["spectrumSmoothingPercent"],
  },
  { key: "spectrumTiltDbPerOctave", kind: "number", min: 0, max: 6, default: 3 },
  {
    key: "spectrumOctaveSmoothing",
    kind: "enum",
    options: ids(SPECTRUM_OCTAVE_SMOOTHING_OPTIONS),
    default: "off",
  },
  {
    kind: "logRange",
    minKey: "spectrumXMinFreq",
    maxKey: "spectrumXMaxFreq",
    defaultMin: 20,
    defaultMax: 20000,
    absMin: 20,
    absMax: 20000,
    minSpan: 1,
  },
  {
    kind: "linearRange",
    minKey: "spectrumYMinDb",
    maxKey: "spectrumYMaxDb",
    defaultMin: -96,
    defaultMax: -12,
    absMin: -120,
    absMax: 0,
    minSpan: 12,
    /// The min was once stored as a span below the max (`spectrumYRangeDb`) rather than as an
    /// absolute bound. Convert before the shared range repair sees it.
    readMin(raw) {
      if (isNumber(raw?.spectrumYMinDb) || !isNumber(raw?.spectrumYRangeDb)) {
        return raw?.spectrumYMinDb;
      }
      return (
        clampNumber(raw?.spectrumYMaxDb, -120, 0, -12) -
        clampNumber(raw.spectrumYRangeDb, 12, 126, 84)
      );
    },
  },
  {
    kind: "logRange",
    minKey: "spectrogramYMinFreq",
    maxKey: "spectrogramYMaxFreq",
    defaultMin: 20,
    defaultMax: 20000,
    absMin: 20,
    absMax: 20000,
    minSpan: 1,
  },
  {
    key: "spectrogramDbFloor",
    kind: "number",
    min: -96,
    max: -12,
    default: SPECTROGRAM_DB_MIN,
  },
  {
    key: "spectrogramMode",
    kind: "enum",
    options: ids(SPECTROGRAM_MODE_OPTIONS),
    default: "heatmap",
  },
  { key: "spectrogram3dColorize", kind: "boolean", default: true },
  {
    // Ranges come from the projection, which is the thing that actually has an opinion about
    // them; see the export there for why they are not restated.
    key: "spectrogram3dHeightGain",
    kind: "number",
    min: HEIGHT_GAIN_MIN,
    max: HEIGHT_GAIN_MAX,
    default: 1,
  },
  { key: "spectrogram3dAzimuthDeg", kind: "degrees", default: 135 },
  {
    /// Clamped at both ends; the projection's own doc says why those two ends.
    key: "spectrogram3dElevationDeg",
    kind: "number",
    min: ELEVATION_MIN_DEG,
    max: ELEVATION_MAX_DEG,
    default: 60,
  },
  {
    // Surfaced as "Grid": it draws the floor grid, and "Floor" sat one row below "dB Floor" with
    // no relation to it. The key keeps the old name -- it is persisted, and renaming it would
    // need a migration to buy nothing a reader of this line does not already get.
    key: "spectrogram3dFloor",
    kind: "boolean",
    default: true,
  },
  {
    kind: "linearRange",
    minKey: "loudnessYMinDb",
    maxKey: "loudnessYMaxDb",
    defaultMin: -64,
    defaultMax: 0,
    absMin: -64,
    absMax: 0,
    minSpan: 12,
  },
  {
    kind: "linearRange",
    minKey: "levelMeterYMinDb",
    maxKey: "levelMeterYMaxDb",
    defaultMin: -60,
    defaultMax: 3,
    absMin: -60,
    absMax: 3,
    minSpan: 12,
  },
  {
    key: "statsVisibleIds",
    kind: "idList",
    options: ids(STATS_OPTIONS),
    default: [
      "momentary",
      "shortTerm",
      "integrated",
      "momentaryMax",
      "shortTermMax",
      "lra",
      "psr",
      "plr",
    ],
  },
  {
    key: "statsOrder",
    kind: "orderedIdList",
    options: [...STATS_CANONICAL_ORDER],
    default: [...STATS_CANONICAL_ORDER],
  },
  {
    key: "dialogueVadEngine",
    default: DEFAULT_DIALOGUE_VAD_ENGINE,
    normalize: (row, raw) => normalizeDialogueVadEngine(readStored(raw, row)),
  },
  {
    key: "loudnessHistoryVisibleLayerIds",
    kind: "idList",
    options: ids(LOUDNESS_HISTORY_LAYER_OPTIONS),
    default: ["momentary", "shortTerm", "ref"],
  },
  {
    key: "stereoMapMode",
    kind: "enum",
    options: Object.values(STEREO_MAP_MODES),
    default: STEREO_MAP_MODES.POSITION,
  },
  {
    /// Shape matches `stereoMapRequestKeyFromControls`'s `{ first, second }` channel-index pair,
    /// not Vectorscope's `{ x, y }` pair. Only shape/type is validated here; clamping to the pair
    /// actually available for the current channel count happens in clampPanelControls.js, same
    /// split as vectorscopePair.
    key: "stereoMapPair",
    kind: "pair",
    members: ["first", "second"],
    default: { first: 0, second: 1 },
  },
  { key: "stereoMapHold", kind: "boolean", default: false },
  { key: "stereoMapSpeedPercent", kind: "number", min: 0, max: 100, default: 50 },
  {
    key: "stereoMapOctaveSmoothing",
    kind: "enum",
    options: ids(SPECTRUM_OCTAVE_SMOOTHING_OPTIONS),
    default: "1/12",
  },
  {
    kind: "logRange",
    minKey: "stereoMapXMinFreq",
    maxKey: "stereoMapXMaxFreq",
    defaultMin: 20,
    defaultMax: 20000,
    absMin: 20,
    absMax: 20000,
    minSpan: 1,
  },
  { key: "stereoMapMonoLossYMinDb", kind: "number", min: -60, max: -6, default: -24 },
  {
    /// M/S Ratio's Y range has no minimum span, only the design's "must include 0 dB" constraint:
    /// each bound clamps to the panel's absolute limits independently, then a bound that ends up
    /// on the wrong side of zero snaps to zero rather than being repaired against the other bound.
    minKey: "stereoMapMsRatioYMinDb",
    maxKey: "stereoMapMsRatioYMaxDb",
    defaultMin: -48,
    defaultMax: 24,
    absMin: -96,
    absMax: 48,
    normalize(row, raw) {
      let min = clampNumber(raw?.[row.minKey], row.absMin, row.absMax, row.defaultMin);
      let max = clampNumber(raw?.[row.maxKey], row.absMin, row.absMax, row.defaultMax);
      if (min > 0) min = 0;
      if (max < 0) max = 0;
      return { [row.minKey]: min, [row.maxKey]: max };
    },
  },
  { key: "waveformFrequencyColor", kind: "boolean", default: false },
  {
    /// The two splits are repaired as a unit: a stored pair that is out of order is not repaired
    /// bound by bound, both fall back to their defaults.
    minKey: "waveformLowMidSplitHz",
    maxKey: "waveformMidHighSplitHz",
    defaultMin: 200,
    defaultMax: 2000,
    absMin: 20,
    absMax: 20000,
    normalize(row, raw) {
      const lowMid = Math.round(
        clampNumber(raw?.[row.minKey], row.absMin, row.absMax, row.defaultMin)
      );
      const midHigh = Math.round(
        clampNumber(raw?.[row.maxKey], row.absMin, row.absMax, row.defaultMax)
      );
      return lowMid < midHigh
        ? { [row.minKey]: lowMid, [row.maxKey]: midHigh }
        : { [row.minKey]: row.defaultMin, [row.maxKey]: row.defaultMax };
    },
  },
  { key: "waveformCentroid", kind: "boolean", default: false },
];

/** A row's contribution to a normalized record: `{ key: value }`, or both bounds for a range. */
function normalizeRow(row, raw) {
  const source = row.readMin ? { ...raw, [row.minKey]: row.readMin(raw) } : raw;
  if (row.normalize) {
    const value = row.normalize(row, source);
    return row.key ? { [row.key]: value } : value;
  }
  if (row.minKey) return normalizeRange(row, source);
  return { [row.key]: KINDS[row.kind](row, source) };
}

function buildDefaults() {
  const defaults = {};
  for (const row of CONTROLS) {
    if (row.key) {
      defaults[row.key] = Array.isArray(row.default)
        ? [...row.default]
        : row.default && typeof row.default === "object"
          ? { ...row.default }
          : row.default;
      continue;
    }
    defaults[row.minKey] = row.defaultMin;
    defaults[row.maxKey] = row.defaultMax;
  }
  return defaults;
}

export const DEFAULT_PANEL_CONTROLS = buildDefaults();

export function normalizePanelControls(raw) {
  const normalized = {};
  for (const row of CONTROLS) {
    Object.assign(normalized, normalizeRow(row, raw));
  }
  return normalized;
}

const ROW_BY_KEY = new Map();
const RANGE_ROW_BY_MIN_KEY = new Map();
for (const row of CONTROLS) {
  if (row.key) ROW_BY_KEY.set(row.key, row);
  else RANGE_ROW_BY_MIN_KEY.set(row.minKey, row);
}

/**
 * Repairs one control's value by its own row. For surfaces that store the same control under a
 * different key -- the Dock does -- so that the repair rule lives in one place even where the key
 * names do not match.
 */
export function normalizePanelControlValue(key, value) {
  const row = ROW_BY_KEY.get(key);
  if (!row) throw new Error(`Unknown panel control: ${key}`);
  return normalizeRow(row, { [key]: value })[key];
}

/** The range counterpart of normalizePanelControlValue, keyed by the range's min key. */
export function normalizePanelControlRange(minKey, rawMin, rawMax) {
  const row = RANGE_ROW_BY_MIN_KEY.get(minKey);
  if (!row) throw new Error(`Unknown panel control range: ${minKey}`);
  return normalizeRow(row, { [row.minKey]: rawMin, [row.maxKey]: rawMax });
}
