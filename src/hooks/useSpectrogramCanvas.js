import { useEffect, useRef } from "react";
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";
import { buildYToBand } from "../math/spectrogramMath.js";
import { inWindowRange, spectrogramFrameEndMs } from "../math/spectrogramTimeline.js";

function paintSpan(data, width, height, xStart, xEnd, snap, yToBand, colormapLut) {
  const rng = SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN;
  for (let y = 0; y < height; y++) {
    const db = snap.dbList[yToBand[y]] ?? SPECTROGRAM_DB_MIN;
    const t = Math.max(0, Math.min(1, (db - SPECTROGRAM_DB_MIN) / rng));
    const lutIdx = Math.round(t * 255) * 3;
    const rowBase = y * width;
    for (let x = xStart; x < xEnd; x++) {
      const idx = (rowBase + x) * 4;
      data[idx] = colormapLut[lutIdx];
      data[idx + 1] = colormapLut[lutIdx + 1];
      data[idx + 2] = colormapLut[lutIdx + 2];
      data[idx + 3] = Math.round(t * 255);
    }
  }
}

function upperBoundTimestamp(view, target, startIdx, endIdx) {
  let lo = startIdx;
  let hi = endIdx + 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function paintSpectrogramImageData(
  imageData,
  snaps,
  startIdx,
  endIdx,
  oldestMs,
  span,
  sampleMs,
  yToBand,
  colormapLut
) {
  const { data, width: W, height: H } = imageData;
  data.fill(0);

  // At long zoom levels, thousands of frames collapse into a few hundred physical pixels. Resolve
  // the newest active frame per pixel instead of walking every retained frame; work is bounded by
  // canvas width while real timestamp gaps remain transparent.
  if (endIdx - startIdx + 1 > W * 4) {
    for (let x = 0; x < W; x++) {
      const targetMs = oldestMs + ((x + 0.5) / W) * span;
      const index = upperBoundTimestamp(snaps, targetMs, startIdx, endIdx) - 1;
      if (index < startIdx || index > endIdx) continue;
      const snap = snaps.rowAt(index);
      if (!snap?.dbList || !Number.isFinite(snap.timestampMs)) continue;
      const frameEndMs = spectrogramFrameEndMs(snaps, index, sampleMs);
      if (!(targetMs >= snap.timestampMs && targetMs < frameEndMs)) continue;
      paintSpan(data, W, H, x, x + 1, snap, yToBand, colormapLut);
    }
    return;
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const snap = snaps.rowAt(i);
    if (!snap || !snap.dbList) continue;
    const ts = snap.timestampMs;
    if (!Number.isFinite(ts)) continue;
    // Place the column at the x of its real timestamp; tiny scheduling jitter is stitched to the
    // next frame, while real gaps in time stay unpainted (blank).
    const xStart = Math.max(0, Math.round(((ts - oldestMs) / span) * W));
    const endMs = spectrogramFrameEndMs(snaps, i, sampleMs);
    const xEnd = Math.min(W, Math.round(((endMs - oldestMs) / span) * W));
    const colW = xEnd - xStart;
    if (colW <= 0) continue;
    paintSpan(data, W, H, xStart, xEnd, snap, yToBand, colormapLut);
  }
}

export function useSpectrogramCanvas({
  canvasRef,
  snapRef,
  oldestMs,
  newestMs,
  sampleMs,
  selectedOffset,
  frozenSnaps,
  colormapLut,
  minHz = 20,
  maxHz = 20000,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({ W: 0, H: 0, yToBand: null, imageData: null });
  const lastPaintRef = useRef({
    len: -1,
    version: -1,
    oldestMs: NaN,
    newestMs: NaN,
    sel: -1,
    W: 0,
    H: 0,
    minHz: 20,
    maxHz: 20000,
    colormapLut: null,
  });

  useEffect(() => {
    paramsRef.current = {
      oldestMs,
      newestMs,
      sampleMs,
      selectedOffset,
      frozenSnaps,
      colormapLut,
      minHz,
      maxHz,
    };
  }, [oldestMs, newestMs, sampleMs, selectedOffset, frozenSnaps, colormapLut, minHz, maxHz]);

  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return;

      const {
        oldestMs,
        newestMs,
        sampleMs,
        selectedOffset,
        frozenSnaps,
        colormapLut,
        minHz,
        maxHz,
      } = paramsRef.current;
      if (!colormapLut || colormapLut.length < 256 * 3) return;
      const snaps = frozenSnaps ?? snapRef.current;
      const len = snaps ? snaps.length : 0;
      const version = snaps?.version ?? 0;

      // Skip repaint when nothing changed.
      const last = lastPaintRef.current;
      if (
        last.len === len &&
        last.version === version &&
        last.oldestMs === oldestMs &&
        last.newestMs === newestMs &&
        last.sel === selectedOffset &&
        last.W === W &&
        last.H === H &&
        last.minHz === minHz &&
        last.maxHz === maxHz &&
        last.colormapLut === colormapLut
      )
        return;
      lastPaintRef.current = {
        len,
        version,
        oldestMs,
        newestMs,
        sel: selectedOffset,
        W,
        H,
        minHz,
        maxHz,
        colormapLut,
      };

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const span = Number.isFinite(oldestMs) && Number.isFinite(newestMs) ? newestMs - oldestMs : 0;
      const cache = cacheRef.current;
      const firstSnap = snaps && snaps.length > 0 ? snaps.rowAt(snaps.length - 1) : null;
      const bands = firstSnap?.bands;
      if (!bands || bands.length === 0 || len === 0 || span <= 0) {
        ctx.clearRect(0, 0, W, H);
        return;
      }
      if (
        cache.W !== W ||
        cache.H !== H ||
        cache.minHz !== minHz ||
        cache.maxHz !== maxHz ||
        !cache.yToBand
      ) {
        cache.yToBand = buildYToBand(bands, H, minHz, maxHz);
        cache.imageData = new ImageData(W, H);
        cache.W = W;
        cache.H = H;
        cache.minHz = minHz;
        cache.maxHz = maxHz;
      }

      const { startIdx, endIdx } = inWindowRange(snaps, oldestMs, newestMs);
      if (endIdx < startIdx) {
        ctx.clearRect(0, 0, W, H);
        return;
      }

      paintSpectrogramImageData(
        cache.imageData,
        snaps,
        startIdx,
        endIdx,
        oldestMs,
        span,
        sampleMs,
        cache.yToBand,
        colormapLut
      );
      ctx.putImageData(cache.imageData, 0, 0);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef]);
}
