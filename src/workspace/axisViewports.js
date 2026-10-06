/** @import { AxisViewports } from "./types.js" */
import { FREQUENCY_VIEWPORT } from "../math/axisInteractionMath.js";
import { HISTORY_MIN_WINDOW_SEC } from "../math/historyMath.js";
import { UI_PREFERENCES } from "../uiPreferences.js";
import { isNumber, normalizeRange } from "../lib/rangeNormalization.js";

/**
 * One entry per linkable axis kind. A kind is a *quantity* — panels sharing it are grouped by what
 * their axis measures, never by which way it points: the spectrogram's frequency axis is vertical
 * and belongs with the spectrum's horizontal one, because reading a harmonic off one and checking
 * its level on the other is the case linking exists for.
 *
 * Each entry doubles as a `normalizeRange` row, so the shared viewport is repaired by exactly the
 * function that repairs the dormant local range it stands in for. `min`/`max` are the shared
 * value's own key names; a member's local keys live in `members`.
 *
 * Adding an axis kind is adding an entry here. Nothing below this line knows what frequency is.
 */
export const AXIS_VIEWPORTS = {
  frequency: {
    id: "frequency",
    linkKey: "linkFrequencyViewport",
    kind: "logRange",
    minKey: "min",
    maxKey: "max",
    defaultMin: FREQUENCY_VIEWPORT.absMin,
    defaultMax: FREQUENCY_VIEWPORT.absMax,
    absMin: FREQUENCY_VIEWPORT.absMin,
    absMax: FREQUENCY_VIEWPORT.absMax,
    minSpan: FREQUENCY_VIEWPORT.minSpan,
    localFields: { min: "minKey", max: "maxKey" },
    members: {
      spectrum: { minKey: "spectrumXMinFreq", maxKey: "spectrumXMaxFreq" },
      spectrogram: { minKey: "spectrogramYMinFreq", maxKey: "spectrogramYMaxFreq" },
      "stereo-map": { minKey: "stereoMapXMinFreq", maxKey: "stereoMapXMaxFreq" },
    },
  },
  time: {
    id: "time",
    linkKey: "linkTimeViewport",
    defaultWindowSec: UI_PREFERENCES.modules.loudness.history.defaultWindowSec,
    minWindowSec: HISTORY_MIN_WINDOW_SEC,
    localFields: { windowSec: "windowSecKey", offsetSec: "offsetSecKey" },
    members: {
      loudness: { windowSecKey: "historyWindowSec", offsetSecKey: "historyOffsetSec" },
      spectrogram: { windowSecKey: "historyWindowSec", offsetSecKey: "historyOffsetSec" },
      waveform: { windowSecKey: "historyWindowSec", offsetSecKey: "historyOffsetSec" },
    },
    normalize(raw) {
      return {
        windowSec: isNumber(raw?.windowSec)
          ? Math.max(HISTORY_MIN_WINDOW_SEC, raw.windowSec)
          : UI_PREFERENCES.modules.loudness.history.defaultWindowSec,
        offsetSec: isNumber(raw?.offsetSec) ? Math.max(0, raw.offsetSec) : 0,
      };
    },
  },
};

/** @returns {string[]} the axis kinds this module can link, empty for modules with none */
/**
 * @returns {string[]} the axis kinds this module can link, empty for modules with none
 * @param {string} moduleId
 */
export function axisKindsForModule(moduleId) {
  return Object.keys(AXIS_VIEWPORTS).filter((kindId) => AXIS_VIEWPORTS[kindId].members[moduleId]);
}

/**
 * One kind's shared viewport, whichever kind it is.
 * @typedef {AxisViewports[keyof AxisViewports]} AxisViewport
 */

/**
 * @overload
 * @param {"frequency"} kindId
 * @param {unknown} raw
 * @returns {AxisViewports["frequency"]}
 */
/**
 * @overload
 * @param {"time"} kindId
 * @param {unknown} raw
 * @returns {AxisViewports["time"]}
 */
/**
 * @overload
 * @param {string} kindId
 * @param {unknown} raw
 * @returns {AxisViewport | null}
 */
/**
 * A repaired shared viewport, whatever it was handed. The kind picks the shape; a kind that is not
 * in the table has no viewport.
 * @param {string} kindId
 * @param {any} raw
 * @returns {AxisViewport | null}
 */
export function normalizeAxisViewport(kindId, raw) {
  const descriptor = AXIS_VIEWPORTS[kindId];
  if (!descriptor) return null;
  if (descriptor.normalize) return descriptor.normalize(raw);
  return /** @type {AxisViewports["frequency"]} */ (normalizeRange(descriptor, raw ?? {}));
}

/** @returns {{ minKey: string, maxKey: string } | null} the panel control keys holding a member's local range */
/**
 * @returns {{minKey: string;maxKey: string;} | null} the panel control keys holding a member's local range
 * @param {string} kindId
 * @param {string} moduleId
 */
export function localRangeKeys(kindId, moduleId) {
  return AXIS_VIEWPORTS[kindId]?.members[moduleId] ?? null;
}

/** @returns {AxisViewport | null} a member's dormant local range, in its kind's own shape */
/**
 * @returns {AxisViewport | null} a member's dormant local range, in its kind's own shape
 * @param {string} kindId
 * @param {string} moduleId
 */
export function readLocalRange(kindId, moduleId, panelControls) {
  const descriptor = AXIS_VIEWPORTS[kindId];
  const keys = localRangeKeys(kindId, moduleId);
  if (!descriptor || !keys) return null;
  return /** @type {AxisViewport} */ (
    Object.fromEntries(
      Object.entries(descriptor.localFields).map(([viewportKey, memberKey]) => [
        viewportKey,
        panelControls?.[keys[memberKey]],
      ])
    )
  );
}

/** @returns {object} a panel-controls patch putting a range under a member's own keys */
/**
 * @returns {object} a panel-controls patch putting a range under a member's own keys
 * @param {string} kindId
 * @param {string} moduleId
 */
export function writeLocalRange(kindId, moduleId, viewport) {
  const descriptor = AXIS_VIEWPORTS[kindId];
  const keys = localRangeKeys(kindId, moduleId);
  if (!descriptor || !keys) return {};
  return Object.fromEntries(
    Object.entries(descriptor.localFields).map(([viewportKey, memberKey]) => [
      keys[memberKey],
      viewport[viewportKey],
    ])
  );
}

/**
 * Repairs the whole `axisViewports` map. Payloads written before a kind existed get its default,
 * and a kind that has since been removed is dropped rather than carried forever -- the table above
 * is the only list of what exists.
 *
 * @returns {AxisViewports}
 */
/**
 * Repairs the whole `axisViewports` map. Payloads written before a kind existed get its default,
 * and a kind that has since been removed is dropped rather than carried forever -- the table above
 * is the only list of what exists.
 * @returns {AxisViewports}
 */
export function normalizeAxisViewportsState(raw) {
  return /** @type {AxisViewports} */ (
    Object.fromEntries(
      Object.keys(AXIS_VIEWPORTS).map((kindId) => [
        kindId,
        normalizeAxisViewport(kindId, raw?.[kindId]),
      ])
    )
  );
}

/**
 * How many panels are currently navigating a kind's shared viewport. Membership is derived, never
 * stored: a panel counts when its module is a member of the kind and its flag is on. Pass
 * `excludePanelId` to ask the question as it will stand once that panel has left.
 */
/**
 * How many panels are currently navigating a kind's shared viewport. Membership is derived, never
 * stored: a panel counts when its module is a member of the kind and its flag is on. Pass
 * `excludePanelId` to ask the question as it will stand once that panel has left.
 * @param {string} kindId
 * @param {string} [excludePanelId]
 */
export function countLinkedParticipants(state, kindId, excludePanelId) {
  const descriptor = AXIS_VIEWPORTS[kindId];
  if (!descriptor) return 0;
  return Object.keys(state?.panelsById ?? {}).filter((panelId) => {
    if (panelId === excludePanelId) return false;
    const moduleId = state.panelsById[panelId]?.moduleId;
    if (!descriptor.members[moduleId]) return false;
    return state.panelControlsById?.[panelId]?.[descriptor.linkKey] === true;
  }).length;
}

/**
 * The range a panel should actually render, and whether it came from the group. This is the only
 * question a panel asks: it never learns where the value is stored.
 *
 * @returns {(AxisViewport & { linked: boolean }) | null} null for a panel outside the kind
 */
/**
 * The range a panel should actually render, and whether it came from the group. This is the only
 * question a panel asks: it never learns where the value is stored.
 * @returns {(AxisViewport & {linked: boolean;}) | null} null for a panel outside the kind
 * @param {string} kindId
 */
export function resolveAxisViewport(state, panelId, kindId) {
  const descriptor = AXIS_VIEWPORTS[kindId];
  const moduleId = state?.panelsById?.[panelId]?.moduleId;
  if (!descriptor?.members[moduleId]) return null;

  const controls = state.panelControlsById?.[panelId];
  if (controls?.[descriptor.linkKey] === true) {
    return { ...normalizeAxisViewport(kindId, state.axisViewports?.[kindId]), linked: true };
  }
  return { ...readLocalRange(kindId, moduleId, controls), linked: false };
}

/**
 * Which axis kind a panel-settings range row belongs to, matched by the control key it edits. Lets
 * the data-driven row renderer hang a link toggle on the right row without a second table naming
 * the same keys.
 */
/**
 * Which axis kind a panel-settings range row belongs to, matched by the control key it edits. Lets
 * the data-driven row renderer hang a link toggle on the right row without a second table naming
 * the same keys.
 */
export function axisKindForRangeRow(moduleId, minKey) {
  // A row that edits a single key has no minKey. Without this guard the comparison below reads
  // `undefined === undefined` for every non-member module and matches the first kind in the table.
  if (!minKey) return null;
  return (
    Object.keys(AXIS_VIEWPORTS).find(
      (kindId) => AXIS_VIEWPORTS[kindId].members[moduleId]?.minKey === minKey
    ) ?? null
  );
}
