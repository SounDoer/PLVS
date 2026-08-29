import { useEffect, useRef } from "react";
import { SPECTROGRAM_DB_MIN } from "../config/scales.js";
import { buildYToBand, buildYTiltDb } from "../math/spectrogramMath.js";
import { inWindowRange, spectrogramFrameEndMs } from "../math/spectrogramTimeline.js";
import { spectrogramColorFrac } from "../theme/spectrogramColormap.js";
import {
  beginPanelCpuSample,
  finishPanelCpuSample,
  recordPanelCpuEvent,
} from "../dev/panelCpuProfiler.js";

/**
 * The colour ramp as whole pixels rather than component bytes, so a painted pixel costs one store
 * instead of four. Packed through a byte view rather than by shifting, which keeps the word order
 * whatever the platform's is.
 *
 * Memoised on the ramp it came from -- one entry, because a session paints from one theme.
 */
let packedLutCache = { source: null, packed: null };

function packedColormap(colormapLut) {
  if (packedLutCache.source === colormapLut) return packedLutCache.packed;
  const packed = new Uint32Array(256);
  const pixel = new Uint8Array(4);
  const asWord = new Uint32Array(pixel.buffer);
  for (let step = 0; step < 256; step++) {
    pixel[0] = colormapLut[step * 3];
    pixel[1] = colormapLut[step * 3 + 1];
    pixel[2] = colormapLut[step * 3 + 2];
    // Alpha rides the same step the colour does: the ramp fades in as it warms up.
    pixel[3] = step;
    packed[step] = asWord[0];
  }
  packedLutCache = { source: colormapLut, packed };
  return packed;
}

function paintSpan(words, width, height, xStart, xEnd, snap, yToBand, packed, dbFloor, yTiltDb) {
  for (let y = 0; y < height; y++) {
    const band = yToBand[y];
    const raw =
      (typeof snap.dbAt === "function" ? snap.dbAt(band) : snap.dbList?.[band]) ?? dbFloor;
    // Rows are stored untilted; the slope tilt is display shaping, precomputed per canvas row
    // because a row always reads the same band. See `spectrumTiltOffsets`.
    const db = yTiltDb ? raw + yTiltDb[y] : raw;
    const word = packed[Math.round(spectrogramColorFrac(db, dbFloor) * 255)];
    const rowBase = y * width;
    for (let x = xStart; x < xEnd; x++) {
      words[rowBase + x] = word;
    }
  }
}

/**
 * Slides the painted image left by whole pixels, which is all a live Spectrogram does between one
 * frame and the next: one 40 ms row is a fraction of a pixel wide, so most frames move the image
 * by nothing at all and the ones that move it move it by one or two columns.
 *
 * Whole pixels only, because that is all an image can shift. The remainder is not thrown away --
 * the caller tracks which instant the leftmost column stands for and shifts again once another
 * whole pixel has accrued, so the image lags the true window by less than one column and never
 * accumulates beyond it.
 */
export function scrollSpectrogramImageData(imageData, shiftPx) {
  const { data, width: W, height: H } = imageData;
  if (!(shiftPx > 0) || shiftPx >= W) return false;
  const words = new Uint32Array(data.buffer, data.byteOffset, W * H);
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    words.copyWithin(rowBase, rowBase + shiftPx, rowBase + W);
  }
  return true;
}

/**
 * How far a slidable image has to move, and which columns it then owes.
 *
 * Split out because it is the whole of the correctness argument: the image's leftmost column
 * stands for `paintedOldestMs`, not for the window's true `oldestMs`, and the two are allowed to
 * differ by up to one column. Returning the new origin rather than deriving it from the window is
 * what keeps that difference bounded instead of accumulating.
 *
 * @returns {{ shiftPx: number, paintedOldestMs: number, xFrom: number }}
 */
export function spectrogramScrollPlan(paintedOldestMs, oldestMs, span, width) {
  const shiftPx = Math.floor(((oldestMs - paintedOldestMs) / span) * width);
  if (!(shiftPx >= 0) || shiftPx >= width) {
    return { shiftPx: width, paintedOldestMs: oldestMs, xFrom: 0 };
  }
  return {
    shiftPx,
    paintedOldestMs: paintedOldestMs + (shiftPx / width) * span,
    // Even a frame that has not earned a whole column redraws the newest one: a row lands in it
    // before it has a column of its own, and one column costs nothing.
    xFrom: width - Math.max(1, shiftPx),
  };
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
  colormapLut,
  dbFloor,
  yTiltDb,
  xFrom = 0,
  xTo = imageData.width
) {
  const { data, width: W, height: H } = imageData;
  const words = new Uint32Array(data.buffer, data.byteOffset, W * H);
  // Cleared per column range rather than whole, so an incremental repaint leaves the columns it is
  // not responsible for alone -- and so a real gap in time stays transparent either way.
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    words.fill(0, rowBase + xFrom, rowBase + xTo);
  }
  const packed = packedColormap(colormapLut);

  // At long zoom levels, thousands of frames collapse into a few hundred physical pixels. Resolve
  // the newest active frame per pixel instead of walking every retained frame; work is bounded by
  // canvas width while real timestamp gaps remain transparent.
  if (endIdx - startIdx + 1 > W * 4) {
    for (let x = xFrom; x < xTo; x++) {
      const targetMs = oldestMs + ((x + 0.5) / W) * span;
      const index = upperBoundTimestamp(snaps, targetMs, startIdx, endIdx) - 1;
      if (index < startIdx || index > endIdx) continue;
      const snap = snaps.rowAt(index);
      if (!snap || (!snap.dbAt && !snap.dbList) || !Number.isFinite(snap.timestampMs)) continue;
      const frameEndMs = spectrogramFrameEndMs(snaps, index, sampleMs);
      if (!(targetMs >= snap.timestampMs && targetMs < frameEndMs)) continue;
      paintSpan(words, W, H, x, x + 1, snap, yToBand, packed, dbFloor, yTiltDb);
    }
    return;
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const snap = snaps.rowAt(i);
    if (!snap || (!snap.dbAt && !snap.dbList)) continue;
    const ts = snap.timestampMs;
    if (!Number.isFinite(ts)) continue;
    // Place the column at the x of its real timestamp; tiny scheduling jitter is stitched to the
    // next frame, while real gaps in time stay unpainted (blank).
    const xStart = Math.max(xFrom, Math.round(((ts - oldestMs) / span) * W));
    const endMs = spectrogramFrameEndMs(snaps, i, sampleMs);
    const xEnd = Math.min(xTo, Math.round(((endMs - oldestMs) / span) * W));
    const colW = xEnd - xStart;
    if (colW <= 0) continue;
    paintSpan(words, W, H, xStart, xEnd, snap, yToBand, packed, dbFloor, yTiltDb);
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
  dbFloor = SPECTROGRAM_DB_MIN,
  tiltDbPerOctave = 0,
  sourceVersion = 0,
  canvasSizeRevision = 0,
  enabled = true,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({
    W: 0,
    H: 0,
    yToBand: null,
    yTiltDb: null,
    bands: null,
    tiltDbPerOctave: NaN,
    imageData: null,
    // Which instant the leftmost painted column stands for, and the view it was painted from.
    // Together they say whether the image on screen can be slid instead of redrawn.
    paintedOldestMs: NaN,
    paintedSpan: NaN,
    paintedSnaps: null,
  });
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
    dbFloor: NaN,
    tiltDbPerOctave: NaN,
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
      dbFloor,
      tiltDbPerOctave,
    };
  }, [
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    frozenSnaps,
    colormapLut,
    minHz,
    maxHz,
    dbFloor,
    tiltDbPerOctave,
  ]);

  useEffect(() => {
    if (!enabled) return;

    function draw() {
      rafRef.current = null;
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
        dbFloor,
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
        last.colormapLut === colormapLut &&
        last.dbFloor === dbFloor &&
        last.tiltDbPerOctave === tiltDbPerOctave
      ) {
        recordPanelCpuEvent("spectrogram2d", "signatureSkip");
        return;
      }
      recordPanelCpuEvent("spectrogram2d", "dirtyPaint");
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
        dbFloor,
        tiltDbPerOctave,
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
        cache.tiltDbPerOctave !== tiltDbPerOctave ||
        cache.bands !== bands ||
        !cache.yToBand
      ) {
        cache.yToBand = buildYToBand(bands, H, minHz, maxHz);
        cache.yTiltDb = buildYTiltDb(cache.yToBand, bands, tiltDbPerOctave);
        cache.imageData = new ImageData(W, H);
        cache.W = W;
        cache.H = H;
        cache.minHz = minHz;
        cache.maxHz = maxHz;
        cache.tiltDbPerOctave = tiltDbPerOctave;
        cache.bands = bands;
        // A fresh buffer holds nothing to slide.
        cache.paintedOldestMs = NaN;
      }

      const { startIdx, endIdx } = inWindowRange(snaps, oldestMs, newestMs);
      if (endIdx < startIdx) {
        ctx.clearRect(0, 0, W, H);
        cache.paintedOldestMs = NaN;
        return;
      }

      // A live window that has only moved forward can slide what is already painted and draw the
      // strip that just came into view. Everything else -- a zoom, a pan, a frozen snapshot, a
      // changed colour ramp, floor, tilt, size or frequency range -- redraws in full, because each
      // of those changes what some already-painted pixel should be. The eligibility test is
      // therefore written as "nothing but time moved", not as a list of things to invalidate: a
      // control added later fails it by default rather than silently keeping a stale image.
      // The window's ends are history timestamps, so its length jitters by milliseconds even when
      // nothing has changed; a zoom is what an actual change looks like. Asking for equality here
      // asked for something a wall clock never gives -- measured at 256 repaints out of 256 -- so
      // the test is in pixels instead: while the image's mapping is within half a column of the
      // live one, the image on screen is still the right image. Measured against the span the
      // image was painted with, not the previous frame's, so a slow drift cannot accumulate past
      // half a column without forcing a repaint that re-anchors it.
      const spanDriftPx = (Math.abs(span - cache.paintedSpan) / span) * W;
      // Named rather than combined, so a profile can say which clause is turning a session's
      // frames into full repaints. Guessing at that cost two rebuilds.
      const blockedBy =
        selectedOffset >= 0
          ? "scrubbing"
          : frozenSnaps
            ? "frozen"
            : cache.paintedSnaps !== snaps
              ? "newView"
              : !Number.isFinite(cache.paintedOldestMs)
                ? "noPaintedImage"
                : !(spanDriftPx < 0.5)
                  ? "spanChanged"
                  : !(oldestMs >= cache.paintedOldestMs)
                    ? "wentBackwards"
                    : null;
      const slidable = blockedBy === null;
      if (blockedBy) recordPanelCpuEvent("spectrogram2d", `noSlide:${blockedBy}`);

      // The image carries its own mapping: the span it was painted with, not the live one. A strip
      // drawn against a different scale would not line up with the columns beside it.
      let paintedSpan = span;
      let paintedOldestMs = oldestMs;
      let xFrom = 0;
      if (slidable) {
        const plan = spectrogramScrollPlan(cache.paintedOldestMs, oldestMs, cache.paintedSpan, W);
        if (plan.xFrom > 0) {
          scrollSpectrogramImageData(cache.imageData, plan.shiftPx);
          paintedSpan = cache.paintedSpan;
          paintedOldestMs = plan.paintedOldestMs;
          xFrom = plan.xFrom;
        }
      }
      // Counted so a profile can tell a strip from a full redraw: they differ by two orders of
      // magnitude, and which one a session actually runs is not visible from the paint's cost
      // alone.
      recordPanelCpuEvent("spectrogram2d", xFrom > 0 ? "slidStrip" : "fullRepaint");

      const stripOldestMs = paintedOldestMs + (xFrom / W) * paintedSpan;
      const strip =
        xFrom > 0
          ? inWindowRange(snaps, stripOldestMs - sampleMs, paintedOldestMs + paintedSpan)
          : { startIdx, endIdx };

      if (strip.endIdx >= strip.startIdx) {
        paintSpectrogramImageData(
          cache.imageData,
          snaps,
          strip.startIdx,
          strip.endIdx,
          paintedOldestMs,
          paintedSpan,
          sampleMs,
          cache.yToBand,
          colormapLut,
          dbFloor,
          cache.yTiltDb,
          xFrom,
          W
        );
      }
      cache.paintedOldestMs = paintedOldestMs;
      cache.paintedSpan = paintedSpan;
      cache.paintedSnaps = snaps;
      ctx.putImageData(cache.imageData, 0, 0);
    }

    recordPanelCpuEvent("spectrogram2d", "scheduled");
    const frame = requestAnimationFrame(() => {
      const startedAt = beginPanelCpuSample();
      recordPanelCpuEvent("spectrogram2d", "callback");
      draw();
      finishPanelCpuSample("spectrogram2d", "callbackDuration", startedAt);
    });
    rafRef.current = frame;
    return () => {
      if (rafRef.current === frame) {
        recordPanelCpuEvent("spectrogram2d", "cancelled");
        cancelAnimationFrame(frame);
        rafRef.current = null;
      }
    };
  }, [
    canvasRef,
    snapRef,
    sourceVersion,
    canvasSizeRevision,
    enabled,
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    frozenSnaps,
    colormapLut,
    minHz,
    maxHz,
    dbFloor,
    tiltDbPerOctave,
  ]);
}
