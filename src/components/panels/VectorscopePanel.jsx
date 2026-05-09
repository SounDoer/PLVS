import { UI_PREFERENCES } from "../../uiPreferences";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { buildVectorscopePairOptions, formatVectorscopePairLabel } from "../../math/vectorscopePairMath.js";

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
  onPairChange,
  pairLabel,
}) {
  const canSelect = typeof onPairChange === "function" && Number.isFinite(channelCount) && channelCount >= 2;
  const stripLabels =
    Number.isFinite(channelCount) && channelCount >= 2 ? getPeakMeterChannelLabels(channelCount, peakLabelContext || {}) : [];
  const options = canSelect ? buildVectorscopePairOptions(channelCount, peakLabelContext) : [];
  const effectiveLabel =
    typeof pairLabel === "string" && pairLabel.length > 0
      ? pairLabel
      : formatVectorscopePairLabel({ x: pairX, y: pairY, channelLabels: stripLabels });
  const px = Number.isFinite(pairX) ? Math.max(0, Math.floor(Number(pairX))) : 0;
  const py = Number.isFinite(pairY) ? Math.max(0, Math.floor(Number(pairY))) : 1;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  const valueKey = `${Number(pairX)}-${Number(pairY)}`;
  return (
    <article className="ui-article ui-min-h-spectrum flex-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <div className="ui-section-title ui-section-title-main min-w-0">Vectorscope</div>
        <div className="flex shrink-0 items-baseline gap-2 text-[length:var(--ui-fs-extra)]">
          {canSelect ? (
            <select
              className="ui-select"
              title={effectiveLabel}
              value={valueKey}
              onChange={(e) => {
                const [xRaw, yRaw] = String(e.target.value).split("-");
                const x = Number.parseInt(xRaw || "0", 10);
                const y = Number.parseInt(yRaw || "1", 10);
                onPairChange({ x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 1 });
              }}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : stripLabels.length > 1 ? (
            <span className="text-[color:var(--ui-color-text-muted)]">{effectiveLabel}</span>
          ) : null}
        </div>
      </div>
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
              strokeWidth={UI_PREFERENCES.modules.vector.charts.vectorscope.strokeWidth * 3}
              opacity={UI_PREFERENCES.modules.vector.charts.vectorscope.axisOpacity * 0.22}
              strokeLinecap="round"
            />
            <path
              d={displayVectorPath || "M 130 130 L 130 130"}
              fill="none"
              stroke={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
              strokeWidth={UI_PREFERENCES.modules.vector.charts.vectorscope.strokeWidth}
              opacity={UI_PREFERENCES.modules.vector.charts.vectorscope.axisOpacity}
            />
            <circle
              cx="130"
              cy="130"
              r="2"
              fill={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
            />
          </svg>
        </div>
        <span className="ui-caption absolute left-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]">{axisXLabel}</span>
        <span className="ui-caption absolute right-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]">{axisYLabel}</span>
      </div>
      <div className="mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-extra)]">
        <div className="shrink-0" style={{ width: "var(--ui-corr-info-left-blank)" }} />
        <div className="flex items-baseline gap-[var(--ui-inline-value-gap)]">
          <span className="text-[color:var(--ui-color-text-muted)]">CORRELATION</span>
          <span
            className={
              Number.isFinite(correlation)
                ? "font-semibold tabular-nums text-[color:var(--ui-color-tp-max)]"
                : "font-semibold text-[color:var(--ui-color-text-muted)]"
            }
          >
            {Number.isFinite(correlation) ? correlation.toFixed(2) : "-"}
          </span>
        </div>
      </div>
    </article>
  );
}
