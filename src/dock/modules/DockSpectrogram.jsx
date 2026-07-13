import { useEffect, useRef } from "react";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";
import { buildYToBand } from "../../math/spectrogramMath.js";
import { buildSpectrogramLut } from "../../theme/spectrogramColormap.js";
import { getTheme } from "../../theme/themeRegistry.js";
import { listCustomThemes } from "../../theme/customThemesRepo.js";
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../../config/scales.js";

const WINDOW_MS = 30_000;
const W = 300;
const H = 56;

/** Scrolling compact spectrogram over the dock's shared spectrum request. */
export function DockSpectrogram({ controls }) {
  const { resolvedThemeId } = useFrameData() ?? {};
  const { getSpectrogramSnapsForKey } = useHistoryData() ?? {};
  const canvasRef = useRef(null);
  const lutRef = useRef(null);
  const themeRef = useRef(null);

  // Repaint on every render: the strip re-renders at frame rate via the
  // frame context, and the canvas is tiny (300x56), matching the visual
  // history cadence closely enough without a dedicated scheduler.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / degraded environments

    if (themeRef.current !== resolvedThemeId) {
      themeRef.current = resolvedThemeId;
      lutRef.current = buildSpectrogramLut(getTheme(resolvedThemeId, listCustomThemes()).colormap);
    }
    const lut = lutRef.current;

    ctx.clearRect(0, 0, W, H);
    const snaps = getSpectrogramSnapsForKey?.(dockSpectrumKey(controls));
    if (!snaps || snaps.length === 0) return;

    const newest = snaps.rowAt(snaps.length - 1);
    if (!newest || !Number.isFinite(newest.timestampMs)) return;
    const newestMs = newest.timestampMs;
    const oldestMs = newestMs - WINDOW_MS;

    const image = ctx.createImageData(W, H);
    const data = image.data;
    const minDb = controls?.minDb ?? SPECTROGRAM_DB_MIN;
    const maxDb = controls?.maxDb ?? SPECTROGRAM_DB_MAX;
    const rng = maxDb - minDb;
    let yToBand = null;
    // Snaps arrive ~every 40ms but a column spans 100ms, so several snaps
    // collide per x. Scanning newest-first, the first writer must win or the
    // oldest of each cluster would overwrite the newest.
    const paintedX = new Uint8Array(W);

    for (let i = snaps.length - 1; i >= 0; i--) {
      const snap = snaps.rowAt(i);
      if (!snap || !snap.dbList || !Number.isFinite(snap.timestampMs)) continue;
      if (snap.timestampMs < oldestMs) break;
      if (!yToBand) {
        yToBand = buildYToBand(snap.bands, H, controls?.minFreq ?? 20, controls?.maxFreq ?? 20_000);
      }
      const x = Math.round(((snap.timestampMs - oldestMs) / WINDOW_MS) * (W - 1));
      if (x < 0 || x >= W || paintedX[x]) continue;
      paintedX[x] = 1;
      for (let y = 0; y < H; y++) {
        const db = snap.dbList[yToBand[y]] ?? minDb;
        const t = Math.max(0, Math.min(1, (db - minDb) / rng));
        const lutIdx = Math.round(t * 255) * 3;
        const idx = (y * W + x) * 4;
        data[idx] = lut[lutIdx];
        data[idx + 1] = lut[lutIdx + 1];
        data[idx + 2] = lut[lutIdx + 2];
        data[idx + 3] = Math.round(t * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  });

  return (
    <div className="h-full min-w-0 flex-1 px-1 py-[4px]">
      <canvas ref={canvasRef} width={W} height={H} className="h-full w-full" />
    </div>
  );
}
