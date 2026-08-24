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

export const STEREO_MAP_MODE_OPTIONS = [
  { id: STEREO_MAP_MODES.POSITION, label: "Position" },
  { id: STEREO_MAP_MODES.CORRELATION, label: "Correlation" },
  { id: STEREO_MAP_MODES.MONO_LOSS_DB, label: "Mono Loss" },
  { id: STEREO_MAP_MODES.MS_RATIO_DB, label: "M/S Ratio" },
];

/// Every 3D-only row shares this condition; the 2D heatmap has no camera.
function is3dSpectrogram(controls) {
  return controls.spectrogramMode !== "heatmap";
}

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

  /**
   * A channel-index pair `{ x, y }`. `legacyMembers` names the fields a control used to store the
   * pair under, for the same reason `legacyKeys` exists one level up.
   */
  pair(row, raw) {
    const value = readStored(raw, row);
    if (value && isNumber(value.x) && isNumber(value.y)) return { x: value.x, y: value.y };
    const [legacyX, legacyY] = row.legacyMembers ?? [];
    if (value && isNumber(value[legacyX]) && isNumber(value[legacyY])) {
      return { x: value[legacyX], y: value[legacyY] };
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
    ui: {
      tab: "levelMeter",
      label: "Mode",
      widget: "select",
      ariaLabel: "level meter mode",
      options: LEVEL_METER_MODE_OPTIONS,
    },
  },
  {
    key: "levelMeterPlaybackMax",
    kind: "boolean",
    default: false,
    ui: {
      tab: "levelMeter",
      label: "Playback Max",
      widget: "switch",
      ariaLabel: "level meter playback max",
      tooltip: "Show the latest playback max as the readout while the bar stays live.",
      showWhen: (controls) => controls.levelMeterMode !== "peak",
    },
  },
  {
    key: "levelMeterValueMarker",
    kind: "boolean",
    default: false,
    ui: {
      tab: "levelMeter",
      label: "Floating Value",
      widget: "switch",
      ariaLabel: "level meter floating value",
      showWhen: (controls) =>
        controls.levelMeterMode === "momentary" || controls.levelMeterMode === "shortTerm",
    },
  },
  {
    key: "levelMeterTpMaxMarker",
    kind: "boolean",
    default: false,
    ui: {
      tab: "levelMeter",
      label: "TP Max",
      widget: "switch",
      ariaLabel: "level meter TP Max",
      showWhen: (controls) => controls.levelMeterMode === "peak",
    },
  },
  {
    key: "vectorscopePair",
    kind: "pair",
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
    // Shared with the Spectrum tab, which renders it through SpectrumDisplaySettingsRows; the
    // Spectrogram tab places it here and supplies its own widget.
    ui: {
      tab: "spectrogram",
      label: "Smoothing",
      widget: "custom",
      order: 20,
      tooltip:
        "Averages the curve across frequency to show tonal balance instead of individual partials. Applies in both 2D and 3D.",
    },
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
    ui: {
      tab: "spectrogram",
      label: "Frequency Range",
      widget: "range",
      ariaLabel: "spectrogram frequency range",
      order: 40,
    },
  },
  {
    key: "spectrogramDbFloor",
    kind: "number",
    min: -96,
    max: -12,
    default: SPECTROGRAM_DB_MIN,
    ui: {
      tab: "spectrogram",
      label: "dB Floor",
      widget: "slider",
      ariaLabel: "spectrogram db floor",
      order: 30,
      step: 1,
      format: (value) => `${value.toFixed(0)} dB`,
      tooltip:
        "Raises the bottom of the display range so the loud part of the signal gets the resolution instead of the noise floor. Applies in both 2D and 3D.",
    },
  },
  {
    key: "spectrogramMode",
    kind: "enum",
    options: ids(SPECTROGRAM_MODE_OPTIONS),
    default: "heatmap",
    ui: {
      tab: "spectrogram",
      label: "Mode",
      widget: "select",
      ariaLabel: "spectrogram mode",
      order: 10,
      options: SPECTROGRAM_MODE_OPTIONS,
      tooltip:
        "3D is a presentation view of the waterfall surface. There is no hover readout in 3D -- switch back to 2D Heatmap to read exact values.",
    },
  },
  {
    key: "spectrogram3dColorize",
    kind: "boolean",
    default: true,
    ui: {
      tab: "spectrogram",
      label: "Colorize",
      widget: "switch",
      ariaLabel: "spectrogram 3d colorize",
      order: 80,
      showWhen: is3dSpectrogram,
    },
  },
  {
    // Ranges come from the projection, which is the thing that actually has an opinion about
    // them; see the export there for why they are not restated.
    key: "spectrogram3dHeightGain",
    kind: "number",
    min: HEIGHT_GAIN_MIN,
    max: HEIGHT_GAIN_MAX,
    default: 1,
    ui: {
      tab: "spectrogram",
      label: "Height Scale",
      widget: "slider",
      ariaLabel: "spectrogram 3d height scale",
      order: 70,
      step: 0.05,
      format: (value) => `${value.toFixed(2)}x`,
      showWhen: is3dSpectrogram,
    },
  },
  {
    key: "spectrogram3dAzimuthDeg",
    kind: "degrees",
    default: 135,
    ui: {
      tab: "spectrogram",
      label: "Azimuth",
      widget: "slider",
      ariaLabel: "spectrogram 3d azimuth",
      order: 60,
      // The slider stops one degree short of a full turn; the row itself wraps, so 359 and 0 are
      // neighbours rather than the two ends of a range.
      min: 0,
      max: 359,
      step: 1,
      format: (value) => `${value.toFixed(0)}\u00b0`,
      resettable: true,
      showWhen: is3dSpectrogram,
    },
  },
  {
    /// Clamped at both ends; the projection's own doc says why those two ends.
    key: "spectrogram3dElevationDeg",
    kind: "number",
    min: ELEVATION_MIN_DEG,
    max: ELEVATION_MAX_DEG,
    default: 60,
    ui: {
      tab: "spectrogram",
      label: "Elevation",
      widget: "slider",
      ariaLabel: "spectrogram 3d elevation",
      order: 50,
      step: 1,
      format: (value) => `${value.toFixed(0)}\u00b0`,
      resettable: true,
      showWhen: is3dSpectrogram,
    },
  },
  {
    // Surfaced as "Grid": it draws the floor grid, and "Floor" sat one row below "dB Floor" with
    // no relation to it. The key keeps the old name -- it is persisted, and renaming it would
    // need a migration to buy nothing a reader of this line does not already get.
    key: "spectrogram3dFloor",
    kind: "boolean",
    default: true,
    ui: {
      tab: "spectrogram",
      label: "Grid",
      widget: "switch",
      ariaLabel: "spectrogram 3d grid",
      order: 90,
      showWhen: is3dSpectrogram,
    },
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
    ui: {
      tab: "stereo-map",
      label: "Mode",
      widget: "select",
      ariaLabel: "stereo map mode",
      options: STEREO_MAP_MODE_OPTIONS,
    },
  },
  {
    /// Stored as `{ x, y }` like every other channel-index pair. It was `{ first, second }` until
    /// the Dock and the panel were put on one set of keys; the analysis request payload still
    /// says `{ first, second }`, because that shape belongs to the Rust request type, not here.
    /// Only shape/type is validated at this point; clamping to the pair actually available for
    /// the current channel count happens in clampPanelControls.js, same split as vectorscopePair.
    key: "stereoMapPair",
    kind: "pair",
    legacyMembers: ["first", "second"],
    default: { x: 0, y: 1 },
    // The widget is supplied by the settings surface, because the options are the channel pairs
    // the current device offers, not anything the table knows. The row still owns where the
    // control sits among the others.
    ui: { tab: "stereo-map", label: "Channel Pair", widget: "custom" },
  },
  {
    key: "stereoMapHold",
    kind: "boolean",
    default: false,
    ui: {
      tab: "stereo-map",
      label: "Max Hold",
      widget: "switch",
      ariaLabel: "stereo map max hold",
    },
  },
  {
    key: "stereoMapSpeedPercent",
    kind: "number",
    min: 0,
    max: 100,
    default: 50,
    ui: {
      tab: "stereo-map",
      label: "Speed",
      widget: "slider",
      ariaLabel: "stereo map speed",
      step: 1,
      format: (value) => `${value.toFixed(0)}%`,
    },
  },
  {
    key: "stereoMapOctaveSmoothing",
    kind: "enum",
    options: ids(SPECTRUM_OCTAVE_SMOOTHING_OPTIONS),
    default: "1/12",
    ui: {
      tab: "stereo-map",
      label: "Smoothing",
      widget: "choiceSelect",
      ariaLabel: "stereo map octave smoothing",
      options: SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
      tooltip:
        "Averages the primitives across frequency before deriving Mode values. Speed smooths over time; this smooths over frequency.",
    },
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
    ui: {
      tab: "stereo-map",
      label: "Frequency Range",
      widget: "range",
      ariaLabel: "stereo map frequency range",
    },
  },
  {
    key: "stereoMapMonoLossYMinDb",
    kind: "number",
    min: -60,
    max: -6,
    default: -24,
    ui: {
      tab: "stereo-map",
      label: "Level Range",
      widget: "rangeMin",
      ariaLabel: "stereo map mono loss level range",
      // Mono Loss is a loss, so the upper bound is fixed at 0 dB; only the floor is editable.
      fixedMax: 0,
      showWhen: (controls) => controls.stereoMapMode === STEREO_MAP_MODES.MONO_LOSS_DB,
    },
  },
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
    ui: {
      tab: "stereo-map",
      label: "Level Range",
      widget: "range",
      ariaLabel: "stereo map m/s ratio level range",
      showWhen: (controls) => controls.stereoMapMode === STEREO_MAP_MODES.MS_RATIO_DB,
    },
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

/**
 * The rows one settings tab renders, in table order. A row carries its own label, widget and
 * visibility rule, so a new control appears in the settings panel by being added to the table --
 * there is no second list of controls to keep in step.
 */
export function panelControlUiRows(tab) {
  return CONTROLS.filter((row) => row.ui?.tab === tab).sort(
    (a, b) => (a.ui.order ?? 0) - (b.ui.order ?? 0)
  );
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
