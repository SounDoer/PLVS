import { useEffect, useRef } from "react";

export function useCanvasSize(canvasRef, containerRef, onResize, options = {}) {
  const onResizeRef = useRef(onResize);
  // maxDevicePixelRatio caps both axes; the per-axis overrides let a caller cap one axis while
  // leaving the other at full DPR (the waveform caps width for decimation cost but keeps height
  // sharp so the near-zero envelope does not collapse to a flickering sub-pixel hairline).
  const maxDprX = options.maxDevicePixelRatioX ?? options.maxDevicePixelRatio;
  const maxDprY = options.maxDevicePixelRatioY ?? options.maxDevicePixelRatio;

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId = 0;

    const capDpr = (rawDpr, cap) =>
      Number.isFinite(cap) && cap > 0 ? Math.min(rawDpr, cap) : rawDpr;

    const resize = () => {
      rafId = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rawDpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * capDpr(rawDpr, maxDprX);
      canvas.height = container.clientHeight * capDpr(rawDpr, maxDprY);
      onResizeRef.current?.({ width: canvas.width, height: canvas.height });
    };

    const ro = new ResizeObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(resize);
    });
    ro.observe(container);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [canvasRef, containerRef, maxDprX, maxDprY]);
}
