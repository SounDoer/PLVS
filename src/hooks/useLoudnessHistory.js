import { useMemo } from "react";
import { LOUDNESS_TICKS } from "../config/scales";
import { buildStatsMetrics } from "@/lib/statsCatalog.js";
import { DEFAULT_REFERENCE_LUFS } from "../settings/defaults.js";

export const HIST_SAMPLE_SEC = 0.1;
export const VISUAL_HIST_SAMPLE_SEC = 0.04;

/**
 * Globally meaningful history facts and loudness metrics shared by the workspace.
 *
 * @param {{ histSourceList, hasHistoryData, running, displayAudio, referenceLufs }} params
 */
export function useLoudnessHistory({
  histSourceList,
  hasHistoryData,
  running,
  displayAudio,
  referenceLufs,
}) {
  const historyChartInteractive = running || hasHistoryData;
  const totalSamples = histSourceList.length;

  // --- Loudness metrics for LoudnessPanel ---

  const targetLufs = Number.isFinite(referenceLufs) ? referenceLufs : DEFAULT_REFERENCE_LUFS;

  const historyYAxisTicks = LOUDNESS_TICKS;

  const statsMetrics = useMemo(() => buildStatsMetrics(displayAudio), [displayAudio]);

  return {
    historyChartInteractive,
    totalSamples,
    // Metrics
    referenceLufs,
    targetLufs,
    historyYAxisTicks,
    statsMetrics,
  };
}
