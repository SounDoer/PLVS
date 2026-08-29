import { useLayoutEffect, useState } from "react";

const EMPTY_CANVAS_SIZE = Object.freeze({ dpr: 1, width: 0, height: 0 });

/** Keeps a canvas backing store in sync without reading layout during ordinary React renders. */
export function useObservedCanvasSize(canvasRef, enabled = true) {
  const [size, setSize] = useState(EMPTY_CANVAS_SIZE);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      setSize((current) =>
        current.dpr === dpr && current.width === width && current.height === height
          ? current
          : { dpr, width, height }
      );
    };

    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [canvasRef, enabled]);

  return size;
}
