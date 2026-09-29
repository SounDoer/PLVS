const BOUNDARY_EPSILON = 1e-6;

export function interiorGridTicks(ticks = []) {
  return ticks.filter(
    (tick) =>
      Number.isFinite(tick?.frac) &&
      tick.frac > BOUNDARY_EPSILON &&
      tick.frac < 1 - BOUNDARY_EPSILON
  );
}

export function ChartGrid({
  visible,
  xTicks = [],
  yTicks = [],
  width,
  height,
  stroke,
  name = "chart",
}) {
  if (!visible) return null;
  const interiorX = interiorGridTicks(xTicks);
  const interiorY = interiorGridTicks(yTicks);
  const dataAttribute = { [`data-${name}-grid`]: "" };
  return (
    <g {...dataAttribute} aria-hidden="true" pointerEvents="none">
      {interiorX.map((tick) => {
        const x = tick.frac * width;
        return (
          <line
            key={`x-${tick.key}`}
            x1={x}
            x2={x}
            y1={0}
            y2={height}
            stroke={stroke}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {interiorY.map((tick) => {
        const y = tick.frac * height;
        return (
          <line
            key={`y-${tick.key}`}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke={stroke}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
