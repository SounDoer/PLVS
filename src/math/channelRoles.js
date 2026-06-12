/**
 * Fixed per-channel role vocabulary and pure helpers for the user channel-label override.
 * Phase 1 is labels only; the Atmos height roles carry no loudness meaning yet (Phase 2).
 */

/** @typedef {{ id: string, label: string }} ChannelRole */

/** @type {readonly ChannelRole[]} */
export const CHANNEL_ROLE_VOCABULARY = Object.freeze([
  { id: "generic", label: "—" },
  { id: "M", label: "M" },
  { id: "L", label: "L" },
  { id: "R", label: "R" },
  { id: "C", label: "C" },
  { id: "LFE", label: "LFE" },
  { id: "Ls", label: "Ls" },
  { id: "Rs", label: "Rs" },
  { id: "Lb", label: "Lb" },
  { id: "Rb", label: "Rb" },
  { id: "Cs", label: "Cs" },
  { id: "Ltf", label: "Ltf" },
  { id: "Rtf", label: "Rtf" },
  { id: "Ltr", label: "Ltr" },
  { id: "Rtr", label: "Rtr" },
]);

const ROLE_LABEL_BY_ID = new Map(CHANNEL_ROLE_VOCABULARY.map((r) => [r.id, r.label]));
const NAMED_LABEL_TO_ID = new Map(
  CHANNEL_ROLE_VOCABULARY.filter((r) => r.id !== "generic").map((r) => [r.label, r.id])
);

/**
 * @param {string[]} tokens
 * @returns {string[]} Display label per channel; `generic` or any unknown token → `Ch n`.
 */
export function roleTokensToLabels(tokens) {
  return tokens.map((token, i) => {
    const label = ROLE_LABEL_BY_ID.get(token);
    return label && token !== "generic" ? label : `Ch ${i + 1}`;
  });
}

/**
 * Seed editor tokens from auto-detected labels. Role-shaped labels (`L`, `Ls`, …) map to their
 * id; numbered (`Ch n`) or unrecognised labels become `generic`.
 * @param {string[]} labels
 * @returns {string[]}
 */
export function seedTokensFromLabels(labels) {
  return labels.map((label) => NAMED_LABEL_TO_ID.get(label) ?? "generic");
}

const VALID_IDS = new Set(CHANNEL_ROLE_VOCABULARY.map((r) => r.id));

/**
 * Validate a persisted overrides blob: keep only entries whose key is a positive integer and whose
 * value is an array of that length containing only known role ids.
 * @param {unknown} raw
 * @returns {Record<number, string[]>}
 */
export function sanitizeChannelLabelOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  /** @type {Record<number, string[]>} */
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const count = Number(key);
    if (!Number.isInteger(count) || count <= 0) continue;
    if (!Array.isArray(value) || value.length !== count) continue;
    if (!value.every((t) => VALID_IDS.has(t))) continue;
    out[count] = value.slice();
  }
  return out;
}
