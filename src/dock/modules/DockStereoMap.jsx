import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { deriveStereoMapRow, STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { StereoMapPlot } from "../../components/panels/StereoMapPlot.jsx";
import { dockStereoMapKey } from "../dockAnalysisRequest.js";
import { normalizeDockModuleControls } from "../dockModuleControls.js";

function rangeForMode(mode, controls) {
  if (mode === STEREO_MAP_MODES.MONO_LOSS_DB) {
    return { lowerBound: controls.monoLossMinDb, upperBound: 0 };
  }
  if (mode === STEREO_MAP_MODES.MS_RATIO_DB) {
    return { lowerBound: controls.msRatioMinDb, upperBound: controls.msRatioMaxDb };
  }
  // Position and Correlation always show their complete normalized range, same as the Workspace
  // panel — Dock has no zoom, so there is nothing to restrict it further.
  return { lowerBound: -1, upperBound: 1 };
}

/**
 * Compact live Stereo Map: current curve, zero baseline, fill, and an optional Hold outline only.
 * No axes, hover marker, wheel zoom, pan, or snapshot interaction — Dock never browses history.
 * `StereoMapPlot` is already pure presentation (the Workspace panel wraps it with the
 * interactive chrome separately), so it is reused here as-is for the compact render.
 */
export function DockStereoMap({ controls = {} }) {
  const { displayAudio, channelCount = 0, peakLabelContext, resolvedThemeId } = useFrameData();
  const historyData = useHistoryData();
  const normalizedControls = normalizeDockModuleControls("stereoMap", controls);
  const mode = normalizedControls.mode;
  const pair = normalizedControls.pair;
  // channelCount is 0 before capture has reported real device info (see appRuntimeDerivations.js) —
  // that's "not started yet", not a mono device, and must not suppress results the same way.
  const isMono = Number.isFinite(channelCount) && channelCount > 0 && channelCount < 2;
  const key = dockStereoMapKey(normalizedControls);
  const range = rangeForMode(mode, normalizedControls);

  const result = !isMono ? displayAudio?.stereoMapResultsByKey?.[key] : null;
  let bandCentersHz = [];
  let points = [];
  if (result) {
    const derived = deriveStereoMapRow(mode, result, range);
    bandCentersHz = derived.bandCentersHz;
    points = derived.points;
  }
  // Live Hold accumulates once per Analysis Key, in the shared StereoMapHistorySlab this key's
  // FrameIntake instance owns (StereoMapHistorySlab#liveHoldValues) — the same object every
  // Workspace/Dock instance on this key reads via getStereoMapHistoryForKey, so this never
  // accumulates a private per-instance copy.
  const holdValues =
    historyData?.getStereoMapHistoryForKey?.(key)?.liveHoldValues?.()?.[mode] ?? null;

  const labelCount = Number.isFinite(channelCount) && channelCount >= 2 ? channelCount : 2;
  const labels = getPeakMeterChannelLabels(labelCount, peakLabelContext || {});
  const firstLabel = labels[pair.x] ?? `Ch ${pair.x + 1}`;
  const secondLabel = labels[pair.y] ?? `Ch ${pair.y + 1}`;
  // Design: Position keeps compact top/bottom pair labels (matching its Y axis: +1 = first
  // channel at the top, -1 = second channel at the bottom); other modes keep only the zero
  // baseline `StereoMapPlot` already draws.
  const showPairLabels = !isMono && mode === STEREO_MAP_MODES.POSITION;

  return (
    <div className="relative h-full min-w-0 flex-1 px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)]">
      <div className="relative h-full w-full">
        <StereoMapPlot
          mode={mode}
          bandCentersHz={bandCentersHz}
          points={points}
          holdValues={holdValues}
          holdVisible={normalizedControls.hold}
          range={range}
          xMinHz={normalizedControls.minFreq}
          xMaxHz={normalizedControls.maxFreq}
          paletteKey="live"
          themeId={resolvedThemeId}
        />
        {showPairLabels ? (
          <div
            data-testid="dock-stereo-map-pair-labels"
            className="pointer-events-none absolute inset-0 flex flex-col justify-between px-0.5 font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground"
          >
            <span className="truncate">{firstLabel}</span>
            <span className="truncate">{secondLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
