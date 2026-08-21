import { useLayoutEffect, useRef, useState } from "react";

/**
 * Measures an axis rail element and reports its length in CSS pixels: height for a y axis, width
 * for an x axis. This is the pixel budget `buildAdaptiveDbTicks` / `buildAdaptiveFreqTicks` need to
 * space labels, so an axis that skips the measurement and hands them a constant gets tick density
 * for a rail size it does not have — labels overlap on a shorter one.
 *
 * `useAxisInteraction` builds on this. Use this hook directly for an axis that is not zoom/pan
 * interactive but still labels adaptive ticks (Stereo Map's y axis).
 */
export function useAxisSize(axis) {
  const axisRef = useRef(null);
  const [axisPx, setAxisPx] = useState(axis === "y" ? 300 : 500);

  useLayoutEffect(() => {
    const el = axisRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = axis === "y" ? rect.height : rect.width;
      if (next > 0) setAxisPx(next);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);

  return { axisRef, axisPx };
}
