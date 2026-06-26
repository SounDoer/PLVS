import { useEffect, useRef } from "react";

export function useCanvasSize(canvasRef, containerRef, onResize, options = {}) {
  const onResizeRef = useRef(onResize);
  const maxDevicePixelRatio = options.maxDevicePixelRatio;

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId = 0;

    const resize = () => {
      rafId = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rawDpr = window.devicePixelRatio || 1;
      const dpr =
        Number.isFinite(maxDevicePixelRatio) && maxDevicePixelRatio > 0
          ? Math.min(rawDpr, maxDevicePixelRatio)
          : rawDpr;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
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
  }, [canvasRef, containerRef, maxDevicePixelRatio]);
}
