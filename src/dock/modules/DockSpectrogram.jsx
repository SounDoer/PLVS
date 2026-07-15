import { useMemo, useRef } from "react";
import { useCanvasSize } from "../../hooks/useCanvasSize.js";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas.js";
import { VISUAL_HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { EMPTY_SPECTRUM_VIEW } from "../../lib/SpectrumHistorySlab.js";
import { buildSpectrogramLut } from "../../theme/spectrogramColormap.js";
import { listCustomThemes } from "../../theme/customThemesRepo.js";
import { getTheme } from "../../theme/themeRegistry.js";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";
import { DockHistoryWindowHud, dockHistoryInteractionProps } from "./DockHistoryInteraction.jsx";

/** Scrolling live spectrogram using the normal panel's canvas painter and theme mapping. */
export function DockSpectrogram({ controls }) {
  const { resolvedThemeId } = useFrameData() ?? {};
  const { getSpectrogramSnapsForKey } = useHistoryData() ?? {};
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const requestKey = dockSpectrumKey(controls);
  const snapRef = useMemo(
    () => ({
      get current() {
        return getSpectrogramSnapsForKey?.(requestKey) ?? EMPTY_SPECTRUM_VIEW;
      },
    }),
    [getSpectrogramSnapsForKey, requestKey]
  );
  const snaps = snapRef.current;
  const latest = snaps.length > 0 ? snaps.rowAt(snaps.length - 1) : null;
  const sampleMs = VISUAL_HIST_SAMPLE_SEC * 1000;
  const newestMs = Number.isFinite(latest?.timestampMs) ? latest.timestampMs + sampleMs : NaN;
  const windowMs = (controls?.dockHistoryWindowSec ?? 60) * 1000;
  const oldestMs = Number.isFinite(newestMs) ? newestMs - windowMs : NaN;
  const colormapLut = useMemo(
    () => buildSpectrogramLut(getTheme(resolvedThemeId, listCustomThemes()).colormap),
    [resolvedThemeId]
  );

  useCanvasSize(canvasRef, containerRef, undefined, { maxDevicePixelRatio: 1 });
  useSpectrogramCanvas({
    canvasRef,
    snapRef,
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset: -1,
    frozenSnaps: null,
    colormapLut,
    minHz: controls?.minFreq ?? 20,
    maxHz: controls?.maxFreq ?? 20_000,
  });

  return (
    <div
      {...dockHistoryInteractionProps(controls)}
      className="relative h-full min-w-0 flex-1 px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)]"
    >
      <div ref={containerRef} className="relative h-full min-h-0 min-w-0">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <DockHistoryWindowHud controls={controls} />
      </div>
    </div>
  );
}
