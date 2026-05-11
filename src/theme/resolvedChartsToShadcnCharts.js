/**
 * Maps resolved product chart strokes to shadcn `--chart-1`…`--chart-5` so Tailwind `text-chart-*`
 * stays aligned with the same resolved palette as SVG `--ui-chart-*` (after `applyUiPreferencesToDocument`).
 *
 * Order: momentary → short-term → vectorscope live → spectrum live → loudness selection.
 */

/**
 * @param {{
 *   loudnessHistory: { momentaryStroke: string; shortTermStroke: string; selectionStroke: string };
 *   vectorscope: { strokeLive: string };
 *   spectrum: { strokeLive: string };
 * }} charts
 * @returns {Record<string, string>}
 */
export function resolvedChartsToShadcnChartCssVars(charts) {
  return {
    "--chart-1": charts.loudnessHistory.momentaryStroke,
    "--chart-2": charts.loudnessHistory.shortTermStroke,
    "--chart-3": charts.vectorscope.strokeLive,
    "--chart-4": charts.spectrum.strokeLive,
    "--chart-5": charts.loudnessHistory.selectionStroke,
  };
}
