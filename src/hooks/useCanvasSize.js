import { useEffect, useRef } from "react";

export function useCanvasSize(canvasRef, containerRef, onResize) {
  const onResizeRef = useRef(onResize);

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
      const dpr = window.devicePixelRatio || 1;
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
  }, [canvasRef, containerRef]);
}
