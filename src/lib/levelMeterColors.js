/// Level Meter bar colours, in one of the two ways the `levelMeterBarColors` control offers.
///
/// Gradient is appearance only: one ramp over the visible bar, the same in every mode, judging
/// nothing and ignoring the Loudness Profile. Level Zones colour by level with hard cuts, so the
/// bar agrees with the readouts at every level: Peak and RMS from the user's Warning / Critical,
/// Momentary and Short-term from the Loudness Profile's ceilings. PLVS does not invent LUFS
/// thresholds, so an unjudged Momentary or Short-term bar shows its Loudness trace colour instead
/// of a green that would itself be a verdict.
///
/// A zone is `{ db, color }`: `color` from `db` up to the next zone's `db`. The first zone starts at
/// `-Infinity`.

import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";
import { DEFAULT_PANEL_CONTROLS } from "./panelControls.js";

export const LEVEL_METER_COLORS = Object.freeze({
  safe: "var(--ui-level-safe)",
  warning: "var(--ui-level-warning)",
  critical: "var(--ui-level-critical)",
});

/// Gradient's pure warning, measured from the top of the bar, not a level; the original, round
/// value. The Theme Preview swatch (`.meter-gradient` in src/index.css) uses the same stop.
const GRADIENT_WARNING_FROM_TOP_PERCENT = 40;

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

function gradient(direction) {
  const { safe, warning, critical } = LEVEL_METER_COLORS;
  return `linear-gradient(${direction}, ${safe} 0%, ${warning} ${
    100 - GRADIENT_WARNING_FROM_TOP_PERCENT
  }%, ${critical} 100%)`;
}

export function thresholdZones(warningDb, criticalDb) {
  return [
    { db: -Infinity, color: LEVEL_METER_COLORS.safe },
    ...(warningDb < criticalDb ? [{ db: warningDb, color: LEVEL_METER_COLORS.warning }] : []),
    { db: criticalDb, color: LEVEL_METER_COLORS.critical },
  ];
}

/// Only ceilings colour the bar. Live loudness drops to silence between phrases, so a floor would
/// hold the bottom of the bar red. Floors stay judged in Stats.
export function profileZones(document, metricId) {
  const metricIds = new Set([metricId, MAX_METRIC[metricId]]);
  const ceilings = (document?.rules ?? [])
    .filter((rule) => !isRuleEmpty(rule) && rule.op === ">" && metricIds.has(rule.metricId))
    .sort((a, b) => a.value - b.value || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  if (ceilings.length === 0) return null;

  const zones = [{ db: -Infinity, color: LEVEL_METER_COLORS.safe }];
  let rank = 0;
  for (const rule of ceilings) {
    if (SEVERITY_RANK[rule.severity] <= rank) continue;
    rank = SEVERITY_RANK[rule.severity];
    zones.push({ db: rule.value, color: SEVERITY_COLOR[rule.severity] });
  }
  return zones;
}

/// Hard cuts: each zone is painted from its own level to the next zone's, clamped to the visible
/// range. Always a `background-image`, even for one colour, so a caller can size or clip it without
/// switching between `background-color` and `background-image`.
export function zonesToGradient(zones, viewMin, viewMax, direction) {
  if (zones.length === 1) {
    return `linear-gradient(${direction}, ${zones[0].color}, ${zones[0].color})`;
  }
  const percent = (db) => {
    const value = Math.min(100, Math.max(0, ((db - viewMin) / (viewMax - viewMin)) * 100));
    return `${Number(value.toFixed(3))}%`;
  };
  const stops = zones.flatMap(({ db, color }, index) => {
    const end = index + 1 < zones.length ? percent(zones[index + 1].db) : "100%";
    return [`${color} ${percent(db)}`, `${color} ${end}`];
  });
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export function levelMeterBackground({
  mode,
  controls,
  profileDocument = null,
  viewMin,
  viewMax,
  direction = "to top",
}) {
  const barColors = controls?.levelMeterBarColors ?? DEFAULT_PANEL_CONTROLS.levelMeterBarColors;
  if (barColors !== "levelZones") return gradient(direction);

  const keys = THRESHOLD_KEYS[mode];
  if (keys) {
    const [warningDb, criticalDb] = keys.map(
      (key) => controls?.[key] ?? DEFAULT_PANEL_CONTROLS[key]
    );
    return zonesToGradient(thresholdZones(warningDb, criticalDb), viewMin, viewMax, direction);
  }
  const zones = profileZones(profileDocument, mode) ?? [
    { db: -Infinity, color: NEUTRAL_COLORS[mode] },
  ];
  return zonesToGradient(zones, viewMin, viewMax, direction);
}

/// The Floating Value marker's status: the metric's own rules, as its Stats row judges them, and
/// the Max metric's ceilings, as the bar colour at the marker's position does under Level Zones.
/// The worse wins; `undefined` means nothing judges the metric.
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
