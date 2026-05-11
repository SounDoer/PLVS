import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM } from "@/lib/shellLayout";
import { UI_PREFERENCES } from "../../uiPreferences";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";

export function VectorscopePanel({
  vsGridDiagInset,
  vsGridDiagFar,
  displayVectorPath,
  selectedOffset,
  correlation,
  channelCount = 0,
  /** @type {import("../../math/peakMeterChannelLabels.js").PeakMeterChannelLabelsContext | undefined} */
  peakLabelContext,
  pairX = 0,
  pairY = 1,
}) {
  // Before metering (0 ch) or waiting for a multichannel layout, show standard L/R for the default 0–1 pair
  // instead of generic Ch 1 / Ch 2.
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const stripLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const px = Number.isFinite(pairX) ? Math.max(0, Math.floor(Number(pairX))) : 0;
  const py = Number.isFinite(pairY) ? Math.max(0, Math.floor(Number(pairY))) : 1;
  const vs = UI_PREFERENCES.modules.vector.charts.vectorscope;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  return (
    <Card
      className={cn(
        PANEL_MIN_SPECTRUM,
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-card)] border-border/80 bg-card/55 py-[var(--ui-article-pad-y)] pl-[var(--ui-article-pad-x)] pr-[var(--ui-article-pad-x)] text-card-foreground shadow-sm backdrop-blur-md",
      )}
    >
      <CardHeader className="shrink-0 space-y-0 p-0 pb-0">
        <CardTitle className="min-w-0 text-[length:var(--ui-fs-section)] font-semibold text-muted-foreground">
          Vectorscope
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0 pt-[var(--ui-section-title-gap)]">
      <div className="relative min-h-0 flex-1 rounded-lg bg-[var(--ui-color-inset-bg)]">
        <div className="absolute inset-[var(--ui-chart-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
          <svg
            className="pointer-events-none absolute inset-0 z-0 block h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1={vsGridDiagInset}
              y1={vsGridDiagInset}
              x2={vsGridDiagFar}
              y2={vsGridDiagFar}
              stroke="var(--ui-vs-grid-diag-stroke)"
              strokeWidth="0.35"
              strokeDasharray="var(--ui-vs-grid-diag-dash)"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={vsGridDiagFar}
              y1={vsGridDiagInset}
              x2={vsGridDiagInset}
              y2={vsGridDiagFar}
              stroke="var(--ui-vs-grid-diag-stroke)"
              strokeWidth="0.35"
              strokeDasharray="var(--ui-vs-grid-diag-dash)"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <svg
            viewBox="0 0 260 260"
            preserveAspectRatio="none"
            className="absolute inset-0 z-[1] block h-full w-full"
          >
            <path
              d={displayVectorPath || "M 130 130 L 130 130"}
              fill="none"
              stroke={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
              strokeWidth={vs.strokeWidth * 3}
              opacity={vs.axisOpacity * 0.22}
              strokeLinecap="round"
            />
            <path
              d={displayVectorPath || "M 130 130 L 130 130"}
              fill="none"
              stroke={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
              strokeWidth={vs.strokeWidth}
              opacity={vs.axisOpacity}
              strokeLinecap="round"
            />
            <circle
              cx="130"
              cy="130"
              r="2"
              fill={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
            />
          </svg>
        </div>
        <span className={cn(CAPTION_TEXT, "absolute left-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]")}>
          {axisXLabel}
        </span>
        <span className={cn(CAPTION_TEXT, "absolute right-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]")}>
          {axisYLabel}
        </span>
      </div>
      <div className="mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-extra)]">
        <div className="shrink-0" style={{ width: "var(--ui-corr-info-left-blank)" }} />
        <div className="flex items-baseline gap-[var(--ui-inline-value-gap)]">
          <span className="text-muted-foreground">CORRELATION</span>
          <span
            className={
              Number.isFinite(correlation)
                ? "ui-numeric font-semibold text-[color:var(--ui-color-tp-max)]"
                : "ui-numeric font-semibold text-muted-foreground"
            }
          >
            {Number.isFinite(correlation) ? correlation.toFixed(2) : "-"}
          </span>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}
