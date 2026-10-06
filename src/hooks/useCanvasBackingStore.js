import { useLayoutEffect, useRef, useState } from "react";

import { watchDevicePixelRatio } from "../lib/devicePixelRatioWatch.js";

const EMPTY_BACKING_SIZE = Object.freeze({ dpr: 1, width: 0, height: 0 });

/**
 * @param {number} dpr
 */
function cappedScale(dpr, cap) {
  return Number.isFinite(cap) && cap > 0 ? Math.min(dpr, cap) : dpr;
}

/**
 * @param {number} cssPx
 * @param {number} dpr
 */
function backingAxis(cssPx, devicePx, dpr, cap) {
  const scale = cappedScale(dpr, cap);
  if (scale === dpr && Number.isFinite(devicePx)) return devicePx;
  return Math.round(cssPx * scale);
}

/**
 * Backing-store size for a canvas box. `box` holds the fractional CSS content box and, where the
 * browser reports it, the device-pixel content box.
 *
 * The device-pixel box is the number of physical pixels the element actually covers after layout
 * snapping, so a backing store of that size maps 1:1 onto the screen and nothing is resampled. The
 * rounded `css x dpr` fallback can be one pixel off, which blurs 1 px lines slightly. A capped axis
 * is resampled by design, so it always uses the cap.
 * @param {any} box
 * @param {number} dpr
 * @param {{ maxDprX?: number, maxDprY?: number }} [options]
 */
export function canvasBackingSize(box, dpr, { maxDprX, maxDprY } = {}) {
  return {
    dpr,
    width: backingAxis(box.cssWidth, box.deviceWidth, dpr, maxDprX),
    height: backingAxis(box.cssHeight, box.deviceHeight, dpr, maxDprY),
  };
}

function observeDevicePixels(observer, canvas) {
  try {
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    // WebKit has no device-pixel box; the CSS box plus the DPR watch covers it there.
    observer.observe(canvas);
  }
}

/**
 * Keeps a canvas backing store sized to the canvas's own box. The single implementation behind
 * every PLVS canvas; see "Screen-space sizes" in docs/architecture.md.
 *
 * Layout is read once when the hook is enabled; after that sizes come from ResizeObserver entries,
 * never from a render. Notifications and DPR changes coalesce into one animation frame.
 * `onResize({ dpr, width, height })` runs only when one of them changed.
 *
 * `maxDevicePixelRatio` caps both axes; `maxDevicePixelRatioX` / `Y` cap one axis (the Waveform caps
 * width for decimation cost and keeps height sharp).
 */
export function useCanvasBackingStore(canvasRef, options = {}) {
  const { onResize, enabled = true } = options;
  const maxDprX = options.maxDevicePixelRatioX ?? options.maxDevicePixelRatio;
  const maxDprY = options.maxDevicePixelRatioY ?? options.maxDevicePixelRatio;
  const onResizeRef = useRef(onResize);

  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let rafId = 0;
    let last = null;
    let box = { cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight };

    const apply = () => {
      rafId = 0;
      const next = canvasBackingSize(box, window.devicePixelRatio || 1, { maxDprX, maxDprY });
      if (
        last &&
        last.dpr === next.dpr &&
        last.width === next.width &&
        last.height === next.height
      ) {
        return;
      }
      last = next;
      if (canvas.width !== next.width) canvas.width = next.width;
      if (canvas.height !== next.height) canvas.height = next.height;
      onResizeRef.current?.(next);
    };
    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(apply);
    };

    apply();
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            const device = entry.devicePixelContentBoxSize?.[0];
            box = {
              cssWidth: entry.contentRect.width,
              cssHeight: entry.contentRect.height,
              deviceWidth: device?.inlineSize,
              deviceHeight: device?.blockSize,
            };
            schedule();
          })
        : null;
    if (observer) observeDevicePixels(observer, canvas);
    const unwatchDpr = watchDevicePixelRatio(() => {
      // The device-pixel box belongs to the old ratio. Fall back to the CSS box until the observer
      // reports the new one.
      box = { cssWidth: box.cssWidth, cssHeight: box.cssHeight };
      schedule();
    });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
      unwatchDpr();
    };
  }, [canvasRef, enabled, maxDprX, maxDprY]);
}

/** `useCanvasBackingStore` for renderers that draw from React state. */
export function useCanvasBackingStoreSize(canvasRef, enabled = true) {
  const [size, setSize] = useState(EMPTY_BACKING_SIZE);
  useCanvasBackingStore(canvasRef, { enabled, onResize: setSize });
  return size;
}
