import { useEffect, useRef } from "react";
import { spectrogramVisibleRange, SPEC_DB_MIN, SPEC_DB_MAX } from "../config/scales.js";
import { buildYToBand } from "../math/spectrogramMath.js";

function paintImageData(
  imageData,
  snaps,
  startIdx,
  count,
  leadingEmptySamples,
  windowSamples,
  yToBand,
  colormapLut
) {
  const { data, width: W, height: H } = imageData;
  const rng = SPEC_DB_MAX - SPEC_DB_MIN;
  data.fill(0);

  for (let col = 0; col < count; col++) {
    const snap = snaps[startIdx + col];
    if (!snap || !snap.dbList) continue;
    const slot = leadingEmptySamples + col;
    const xStart = Math.round((slot * W) / windowSamples);
    const xEnd = Math.round(((slot + 1) * W) / windowSamples);
    const colW = xEnd - xStart;
    if (colW <= 0) continue;
    for (let y = 0; y < H; y++) {
      const db = snap.dbList[yToBand[y]] ?? SPEC_DB_MIN;
      const t = Math.max(0, Math.min(1, (db - SPEC_DB_MIN) / rng));
      const lutIdx = Math.round(t * 255) * 3;
      const r = colormapLut[lutIdx];
      const g = colormapLut[lutIdx + 1];
      const b = colormapLut[lutIdx + 2];
      const rowBase = y * W;
      for (let dx = 0; dx < colW; dx++) {
        const idx = (rowBase + xStart + dx) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = Math.round(t * 255);
      }
    }
  }
}

export function useSpectrogramCanvas({
  canvasRef,
  snapRef,
  effectiveOffsetSamples,
  visibleSamples,
  selectedOffset,
  frozenSnaps,
  colormapLut,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({ W: 0, H: 0, yToBand: null, imageData: null });
  const lastPaintRef = useRef({
    len: -1,
    offset: -1,
    visible: -1,
    sel: -1,
    W: 0,
    H: 0,
    colormapLut: null,
  });

  useEffect(() => {
    paramsRef.current = {
      effectiveOffsetSamples,
      visibleSamples,
      selectedOffset,
      frozenSnaps,
      colormapLut,
    };
  });

  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return;

      const { effectiveOffsetSamples, visibleSamples, selectedOffset, frozenSnaps, colormapLut } =
        paramsRef.current;
      if (!colormapLut || colormapLut.length < 256 * 3) return;
      const snaps = frozenSnaps ?? snapRef.current;
      const len = snaps ? snaps.length : 0;

      // Skip repaint when nothing changed.
      const last = lastPaintRef.current;
      if (
        last.len === len &&
        last.offset === effectiveOffsetSamples &&
        last.visible === visibleSamples &&
        last.sel === selectedOffset &&
        last.W === W &&
        last.H === H &&
        last.colormapLut === colormapLut
      )
        return;
      lastPaintRef.current = {
        len,
        offset: effectiveOffsetSamples,
        visible: visibleSamples,
        sel: selectedOffset,
        W,
        H,
        colormapLut,
      };

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Rebuild per-pixel frequency lookup when canvas size or band set changes.
      const cache = cacheRef.current;
      const firstSnap = snaps && snaps.length > 0 ? snaps[snaps.length - 1] : null;
      const bands = firstSnap?.bands;
      if (!bands || bands.length === 0 || len === 0) {
        ctx.clearRect(0, 0, W, H);
        return;
      }
      if (cache.W !== W || cache.H !== H || !cache.yToBand) {
        cache.yToBand = buildYToBand(bands, H);
        cache.imageData = new ImageData(W, H);
        cache.W = W;
        cache.H = H;
      }

      const { startIdx, count, leadingEmptySamples, windowSamples } = spectrogramVisibleRange(
        len,
        effectiveOffsetSamples,
        visibleSamples
      );
      if (count === 0) {
        ctx.clearRect(0, 0, W, H);
        return;
      }

      paintImageData(
        cache.imageData,
        snaps,
        startIdx,
        count,
        leadingEmptySamples,
        windowSamples,
        cache.yToBand,
        colormapLut
      );
      ctx.putImageData(cache.imageData, 0, 0);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef]);
}
