/// A vertical SVG gradient built from `loudnessTraceGradientStops`. `userSpaceOnUse` over the full
/// plot height is what makes the stops track value (y) rather than the trace's own bounding box.
export function RuleGradient({ id, stops, height = 220 }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={height}>
      {stops.map((stop, i) => (
        <stop key={i} offset={stop.offset} style={{ stopColor: stop.color }} />
      ))}
    </linearGradient>
  );
}
