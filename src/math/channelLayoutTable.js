/**
 * Channel roles and standard layouts, read from the shared table that Rust also embeds
 * (`src-tauri/src/dsp/channel_layouts.rs`). Weights and layout order live in that file only.
 *
 * @typedef {{ id: string, label: string, weight: number }} ChannelRoleEntry
 * @typedef {{ id: string, name: string, roles: string[] }} ChannelLayoutEntry
 */

import table from "../../shared/channel-layouts.json";

// Deep-freeze so every accessor has the same contract: nothing handed out, whether a direct
// export or a derived array like `layoutsForChannelCount`'s filter result, can mutate the
// module-level singleton. The table is tiny (19 roles, 13 layouts), so freezing it eagerly costs
// nothing measurable.
for (const layout of table.layouts) {
  Object.freeze(layout.roles);
  Object.freeze(layout);
}
for (const role of table.roles) {
  Object.freeze(role);
}

/** @type {readonly ChannelRoleEntry[]} */
export const CHANNEL_ROLES = Object.freeze(table.roles);

/** @type {readonly ChannelLayoutEntry[]} */
export const CHANNEL_LAYOUTS = Object.freeze(table.layouts);

const WEIGHT_BY_ROLE = new Map(CHANNEL_ROLES.map((r) => [r.id, r.weight]));

/**
 * @param {string} role
 * @returns {number | null}
 */
export function roleWeight(role) {
  return WEIGHT_BY_ROLE.has(role) ? WEIGHT_BY_ROLE.get(role) : null;
}

/**
 * @param {string} layoutId
 * @returns {string[]} Empty when the id is unknown.
 */
export function rolesForLayout(layoutId) {
  const layout = CHANNEL_LAYOUTS.find((l) => l.id === layoutId);
  return layout ? [...layout.roles] : [];
}

/**
 * @param {string[]} roles
 * @returns {string | null} The layout whose roles equal `roles`, in order.
 */
export function layoutIdForRoles(roles) {
  if (!Array.isArray(roles)) return null;
  const match = CHANNEL_LAYOUTS.find(
    (l) => l.roles.length === roles.length && l.roles.every((role, i) => role === roles[i])
  );
  return match ? match.id : null;
}

/**
 * @param {number} channels
 * @returns {ChannelLayoutEntry[]} Layouts with exactly this channel count, in table order.
 */
export function layoutsForChannelCount(channels) {
  return CHANNEL_LAYOUTS.filter((l) => l.roles.length === channels);
}

/**
 * @param {string[]} roles
 * @returns {number[] | null} Null when any role is unknown.
 */
export function weightsForRoles(roles) {
  const out = [];
  for (const role of roles) {
    const weight = roleWeight(role);
    if (weight === null) return null;
    out.push(weight);
  }
  return out;
}

/**
 * @param {number} channels
 * @returns {string | null} The auto-detected layout: the sole layout with this channel count, or
 * `7.1` for 8 channels, which is also 5.1.2 and keeps its pre-B1 reading. Null above 8.
 */
export function standardLayoutIdForCount(channels) {
  if (!(channels >= 1 && channels <= 8)) return null;
  const matches = layoutsForChannelCount(Math.floor(channels));
  return matches.length > 0 ? matches[0].id : null;
}
