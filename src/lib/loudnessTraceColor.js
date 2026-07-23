/// Band-aware colouring for a Loudness history trace.
///
/// The history chart draws each trace with a single vertical gradient: because y maps to value, a
/// gradient stop at a rule's threshold paints every part of the trace on the breaching side of it.
/// So one metric's rules become a stack of value bands, each the worst severity that applies there,
/// and the trace tints exactly where it is out of spec -- above a ceiling, below a floor, or both.
///
/// Returns the gradient stops (offset 0 = top = highest value), or null when the trace should stay
/// its plain colour: no filled rules, or nothing breaches anywhere in the visible range.

const SEVERITY_COLOR = {
  warn: "var(--ui-signal-warn)",
  fail: "var(--ui-signal-bad)",
};
const SEVERITY_RANK = { warn: 1, fail: 2 };

function worstSeverityAt(rules, value) {
  let worst = null;
  for (const rule of rules) {
    const fires = rule.op === ">" ? value > rule.value : value < rule.value;
    if (fires && (!worst || SEVERITY_RANK[rule.severity] > SEVERITY_RANK[worst])) {
      worst = rule.severity;
    }
  }
  return worst;
}

export function loudnessTraceGradientStops(rules, yRange, normalColor) {
  const filled = (rules ?? []).filter(
    (rule) => Number.isFinite(rule.value) && (rule.op === ">" || rule.op === "<")
  );
  if (filled.length === 0) return null;

  const { min, max } = yRange ?? {};
  if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) return null;

  const offsetOf = (value) => Math.max(0, Math.min(1, (max - value) / (max - min)));
  const colorOf = (severity) => (severity ? SEVERITY_COLOR[severity] : normalColor);

  // Threshold values strictly inside the visible range split it into bands, high -> low. A
  // threshold outside the range does not split anything but still classifies the single band via
  // `worstSeverityAt`, so a rule that breaches the whole visible range still colours it.
  const bounds = [...new Set(filled.map((rule) => rule.value))]
    .filter((value) => value > min && value < max)
    .sort((a, b) => b - a);

  const edges = [max, ...bounds, min];
  const stops = [];
  let anyBreach = false;
  for (let i = 0; i < edges.length - 1; i += 1) {
    const hi = edges[i];
    const lo = edges[i + 1];
    const severity = worstSeverityAt(filled, (hi + lo) / 2);
    if (severity) anyBreach = true;
    const color = colorOf(severity);
    stops.push({ offset: offsetOf(hi), color });
    stops.push({ offset: offsetOf(lo), color });
  }

  return anyBreach ? stops : null;
}
