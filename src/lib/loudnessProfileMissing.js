/// Which metrics the active profile needs but Stats is not currently showing, and how to fix it.
///
/// The user-facing story is only "some required stats are not shown". Some of these ids happen to
/// be dialogue rows, and showing those is already what drives the dialogue/VAD path -- that stays
/// an implementation detail here and must not leak into copy (see the design doc, §Missing stats).

import { isRuleEmpty } from "./loudnessProfileCatalog.js";

/// Preferred metrics the profile needs that are not visible in Stats, in the profile's own order.
/// A rule the user has added but not yet filled in is skipped -- fulfilling it would push a row on
/// screen for a metric nothing is judging yet. A metric the profile only describes is still
/// demanded when it is preferred, because a descriptor earns its row by giving another rule the
/// context to be read against.
export function listMissingPreferredMetrics(document, statsVisibleIds) {
  if (!document) return [];
  const visible = new Set(statsVisibleIds ?? []);
  return (document.preferredMetricIds ?? [])
    .filter((id) => !isRuleEmpty(document.metrics?.[id]))
    .filter((id) => !visible.has(id));
}

/// Appends the missing ids, preserving the order of what is already shown. Append-only: the user
/// arranged those rows, so fulfilling a profile's needs must never reorder or remove them.
export function planShowMissing(statsVisibleIds, missingIds) {
  const visible = statsVisibleIds ?? [];
  const seen = new Set(visible);
  const additions = (missingIds ?? []).filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (additions.length === 0) return visible;
  return [...visible, ...additions];
}
