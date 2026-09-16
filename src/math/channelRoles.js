/**
 * Fixed per-channel role vocabulary and pure helpers for the user channel-label override.
 * Roles drive both labels and BS.1770-5 loudness weights (Annex 3 Table 5). Vocabulary and
 * weights come from the shared table so Rust and the frontend never drift apart.
 */

import { CHANNEL_ROLES, roleWeight } from "./channelLayoutTable.js";

/** @typedef {{ id: string, label: string }} ChannelRole */

/** @type {readonly ChannelRole[]} */
export const CHANNEL_ROLE_VOCABULARY = Object.freeze(
  CHANNEL_ROLES.map(({ id, label }) => ({ id, label }))
);

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

/**
 * @param {string[]} tokens
 * @returns {number[]} Linear BS.1770 energy multipliers, one per channel.
 */
export function roleTokensToLoudnessWeights(tokens) {
  return tokens.map((token) => roleWeight(token) ?? 1);
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
