/// Level Meter colours, anchored to levels rather than to the bar's height.
///
/// A stop is `{ db, color }`: the level where `color` becomes pure. The gradient between stops
/// blends; above the highest stop the colour stays pure. Pure safe sits at the absolute minimum of
/// the mode's scale -- the axis's zoom limit, not the visible minimum -- so the gradient is defined
/// over the whole scale and zooming only crops it: a level has one colour at every zoom.
///
/// Peak and RMS read the user's thresholds. Momentary and Short-term read only the Loudness
/// Profile: PLVS does not invent LUFS thresholds, and a bar nothing judges shows its Loudness
/// trace colour instead of a green that would itself be a verdict.

import { LOUDNESS_DB_MIN, PEAK_DB_MIN } from "../config/scales.js";
import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";
import { DEFAULT_PANEL_CONTROLS } from "./panelControls.js";

export const LEVEL_METER_COLORS = Object.freeze({
  safe: "var(--ui-level-safe)",
  warning: "var(--ui-level-warning)",
  critical: "var(--ui-level-critical)",
});

const NEUTRAL_COLORS = Object.freeze({
  momentary: "var(--ui-loudness-momentary)",
  shortTerm: "var(--ui-loudness-shortterm)",
});

const THRESHOLD_KEYS = Object.freeze({
  peak: ["levelMeterPeakWarningDb", "levelMeterPeakCriticalDb"],
  rms: ["levelMeterRmsWarningDb", "levelMeterRmsCriticalDb"],
});

/// The Max metric whose ceilings also bound the live value: the moment the bar crosses a Max
/// ceiling, the Max breaches.
const MAX_METRIC = Object.freeze({ momentary: "momentaryMax", shortTerm: "shortTermMax" });

const SEVERITY_COLOR = Object.freeze({
  warn: LEVEL_METER_COLORS.warning,
  fail: LEVEL_METER_COLORS.critical,
});
const SEVERITY_RANK = Object.freeze({ warn: 1, fail: 2 });
const STATUS_RANK = Object.freeze({ ok: 1, pending: 1, warn: 2, fail: 3 });

export function thresholdStops(scaleMin, warningDb, criticalDb) {
  return [
    { db: scaleMin, color: LEVEL_METER_COLORS.safe },
    ...(warningDb < criticalDb ? [{ db: warningDb, color: LEVEL_METER_COLORS.warning }] : []),
    { db: criticalDb, color: LEVEL_METER_COLORS.critical },
  ];
}

/// Only ceilings colour the bar. Live loudness drops to silence between phrases, so a floor would
/// hold the bottom of the bar red, and pure safe between a floor and a ceiling would need an
/// invented midpoint. Floors stay judged in Stats.
export function profileStops(document, metricId, scaleMin) {
  const metricIds = new Set([metricId, MAX_METRIC[metricId]]);
  const ceilings = (document?.rules ?? [])
    .filter((rule) => !isRuleEmpty(rule) && rule.op === ">" && metricIds.has(rule.metricId))
    .sort((a, b) => a.value - b.value || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  if (ceilings.length === 0) return null;

  const kept = [];
  let rank = 0;
  for (const rule of ceilings) {
    if (SEVERITY_RANK[rule.severity] <= rank) continue;
    rank = SEVERITY_RANK[rule.severity];
    kept.push({ db: rule.value, color: SEVERITY_COLOR[rule.severity] });
  }
  return kept[0].db <= scaleMin
    ? kept
    : [{ db: scaleMin, color: LEVEL_METER_COLORS.safe }, ...kept];
}

/// Always a `background-image`, even for one colour, so a caller can size or clip it without
/// switching between `background-color` and `background-image`.
export function stopsToGradient(stops, viewMin, viewMax, direction) {
  if (stops.length === 1) {
    return `linear-gradient(${direction}, ${stops[0].color}, ${stops[0].color})`;
  }
  const percent = (db) => `${Number((((db - viewMin) / (viewMax - viewMin)) * 100).toFixed(3))}%`;
  return `linear-gradient(${direction}, ${stops
    .map(({ db, color }) => `${color} ${percent(db)}`)
    .join(", ")})`;
}

export function levelMeterBackground({
  mode,
  controls,
  profileDocument = null,
  viewMin,
  viewMax,
  direction = "to top",
}) {
  const keys = THRESHOLD_KEYS[mode];
  if (keys) {
    const [warningDb, criticalDb] = keys.map(
      (key) => controls?.[key] ?? DEFAULT_PANEL_CONTROLS[key]
    );
    return stopsToGradient(
      thresholdStops(PEAK_DB_MIN, warningDb, criticalDb),
      viewMin,
      viewMax,
      direction
    );
  }
  const stops = profileStops(profileDocument, mode, LOUDNESS_DB_MIN) ?? [
    { db: LOUDNESS_DB_MIN, color: NEUTRAL_COLORS[mode] },
  ];
  return stopsToGradient(stops, viewMin, viewMax, direction);
}

/// The Floating Value marker's status: the metric's own rules, as its Stats row judges them, and
/// the Max metric's ceilings, as the bar colour at the marker's position does. The worse wins;
/// `undefined` means nothing judges the metric.
export function levelMeterMarkerStatus(document, metricId, value) {
  if (!document) return undefined;
  const own = loudnessProfileEvaluate(document, { values: { [metricId]: value } })[metricId];
  const maxId = MAX_METRIC[metricId];
  const maxCeilings = {
    ...document,
    rules: (document.rules ?? []).filter((rule) => rule.metricId === maxId && rule.op === ">"),
  };
  const max = loudnessProfileEvaluate(maxCeilings, { values: { [maxId]: value } })[maxId];
  return (STATUS_RANK[max] ?? 0) > (STATUS_RANK[own] ?? 0) ? max : own;
}
