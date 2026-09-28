export const CHART_CROSSHAIR_CLASS = "border-dashed border-muted-foreground/50";

export function ChartCrosshair({ leftPct, topPct }) {
  return (
    <>
      {leftPct != null ? (
        <div
          data-chart-crosshair="vertical"
          className={`absolute bottom-0 top-0 border-l ${CHART_CROSSHAIR_CLASS}`}
          style={{ left: `${leftPct}%` }}
        />
      ) : null}
      {topPct != null ? (
        <div
          data-chart-crosshair="horizontal"
          className={`absolute left-0 right-0 border-t ${CHART_CROSSHAIR_CLASS}`}
          style={{ top: `${topPct}%` }}
        />
      ) : null}
    </>
  );
}
