import { FREQUENCY_VIEWPORT } from "../math/axisInteractionMath.js";
import { normalizeRange } from "../lib/rangeNormalization.js";

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
    members: {
      spectrum: { minKey: "spectrumXMinFreq", maxKey: "spectrumXMaxFreq" },
      spectrogram: { minKey: "spectrogramYMinFreq", maxKey: "spectrogramYMaxFreq" },
      "stereo-map": { minKey: "stereoMapXMinFreq", maxKey: "stereoMapXMaxFreq" },
    },
  },
};

/** @returns {string[]} the axis kinds this module can link, empty for modules with none */
export function axisKindsForModule(moduleId) {
  return Object.keys(AXIS_VIEWPORTS).filter((kindId) => AXIS_VIEWPORTS[kindId].members[moduleId]);
}

/** @returns {{ min: number, max: number }} a repaired shared viewport, whatever it was handed */
export function normalizeAxisViewport(kindId, raw) {
  const descriptor = AXIS_VIEWPORTS[kindId];
  if (!descriptor) return null;
  return normalizeRange(descriptor, raw ?? {});
}

/** @returns {{ minKey: string, maxKey: string } | null} the panel control keys holding a member's local range */
export function localRangeKeys(kindId, moduleId) {
  return AXIS_VIEWPORTS[kindId]?.members[moduleId] ?? null;
}

/** @returns {{ min: number, max: number } | null} a member's dormant local range */
export function readLocalRange(kindId, moduleId, panelControls) {
  const keys = localRangeKeys(kindId, moduleId);
  if (!keys) return null;
  return { min: panelControls?.[keys.minKey], max: panelControls?.[keys.maxKey] };
}

/** @returns {object} a panel-controls patch putting a range under a member's own keys */
export function writeLocalRange(kindId, moduleId, { min, max }) {
  const keys = localRangeKeys(kindId, moduleId);
  if (!keys) return {};
  return { [keys.minKey]: min, [keys.maxKey]: max };
}

/**
 * Repairs the whole `axisViewports` map. Payloads written before a kind existed get its default,
 * and a kind that has since been removed is dropped rather than carried forever -- the table above
 * is the only list of what exists.
 *
 * @returns {Record<string, { min: number, max: number }>}
 */
export function normalizeAxisViewportsState(raw) {
  return Object.fromEntries(
    Object.keys(AXIS_VIEWPORTS).map((kindId) => [
      kindId,
      normalizeAxisViewport(kindId, raw?.[kindId]),
    ])
  );
}

/**
 * How many panels are currently navigating a kind's shared viewport. Membership is derived, never
 * stored: a panel counts when its module is a member of the kind and its flag is on. Pass
 * `excludePanelId` to ask the question as it will stand once that panel has left.
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
 * @returns {{ min: number, max: number, linked: boolean } | null} null for a panel outside the kind
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
