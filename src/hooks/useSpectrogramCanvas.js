import { useEffect, useRef } from "react";
import { spectrogramColor, SPEC_DB_MIN, SPEC_DB_MAX } from "../config/scales.js";
import { buildYToBand, spectrogramColumnRanges } from "../math/spectrogramMath.js";

// Flat RGB byte lookup (256 entries × 3 bytes) for zero-allocation hot path.
const _INFERNO_FLAT = (() => {
  const flat = new Uint8Array(256 * 3);
  const rng = SPEC_DB_MAX - SPEC_DB_MIN;
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = spectrogramColor(SPEC_DB_MIN + (i / 255) * rng);
    flat[i * 3] = r;
    flat[i * 3 + 1] = g;
    flat[i * 3 + 2] = b;
  }
  return flat;
})();

function paintImageData(imageData, snaps, ranges, yToBand) {
  const { data, width: W, height: H } = imageData;
  const rng = SPEC_DB_MAX - SPEC_DB_MIN;
  data.fill(0);

  const bucketCount = ranges.length;
  if (bucketCount === 0) return;

  // Band count from the first non-empty column's snapshot.
  let bandCount = 0;
  for (let x = 0; x < bucketCount; x++) {
    const [i0, i1] = ranges[x];
    if (i1 > i0 && snaps[i0] && snaps[i0].dbList) {
      bandCount = snaps[i0].dbList.length;
      break;
    }
  }
  if (bandCount === 0) return;

  const colDb = new Float32Array(bandCount);
  const lastColDb = new Float32Array(bandCount);
  let hasLast = false;

  for (let x = 0; x < bucketCount; x++) {
    const [i0, i1] = ranges[x];
    let colData;

    if (i1 > i0) {
      colDb.fill(SPEC_DB_MIN);
      for (let i = i0; i < i1; i++) {
        const dl = snaps[i] && snaps[i].dbList;
        if (!dl) continue;
        for (let b = 0; b < bandCount; b++) {
          if (dl[b] > colDb[b]) colDb[b] = dl[b];
        }
      }
      colData = colDb;
      lastColDb.set(colDb);
      hasLast = true;
    } else if (hasLast) {
      colData = lastColDb; // carry forward across an empty (upsampled) column
    } else {
      continue; // leading empty → stays black
    }

    const xStart = Math.round((x * W) / bucketCount);
    const xEnd = Math.round(((x + 1) * W) / bucketCount);
    if (xEnd <= xStart) continue;

    for (let y = 0; y < H; y++) {
      const db = colData[yToBand[y]] ?? SPEC_DB_MIN;
      const t = Math.max(0, Math.min(1, (db - SPEC_DB_MIN) / rng));
      const lutIdx = Math.round(t * 255) * 3;
      const r = _INFERNO_FLAT[lutIdx];
      const g = _INFERNO_FLAT[lutIdx + 1];
      const b = _INFERNO_FLAT[lutIdx + 2];
      const a = Math.round(t * 255);
      const rowBase = y * W;
      for (let dx = xStart; dx < xEnd; dx++) {
        const idx = (rowBase + dx) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
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
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({ W: 0, H: 0, yToBand: null, imageData: null });
  const lastPaintRef = useRef({ len: -1, offset: -1, visible: -1, sel: -1, W: 0, H: 0 });

  useEffect(() => {
    paramsRef.current = { effectiveOffsetSamples, visibleSamples, selectedOffset, frozenSnaps };
  });

  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return;

      const { effectiveOffsetSamples, visibleSamples, selectedOffset, frozenSnaps } =
        paramsRef.current;
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
        last.H === H
      )
        return;
      lastPaintRef.current = {
        len,
        offset: effectiveOffsetSamples,
        visible: visibleSamples,
        sel: selectedOffset,
        W,
        H,
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

      const { ranges } = spectrogramColumnRanges(len, effectiveOffsetSamples, visibleSamples, W);
      let anyData = false;
      for (let x = 0; x < ranges.length; x++) {
        if (ranges[x][1] > ranges[x][0]) {
          anyData = true;
          break;
        }
      }
      if (!anyData) {
        ctx.clearRect(0, 0, W, H);
        return;
      }

      paintImageData(cache.imageData, snaps, ranges, cache.yToBand);
      ctx.putImageData(cache.imageData, 0, 0);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef]);
}
