import { useMemo, useState } from "react";

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
  const [axisPx, setAxisPx] = useState(axis === "y" ? 300 : 500);
  // Observe the actual attached node, including rails mounted after a visibility switch.
  // Keep .current for gesture handlers that need the latest bounding rectangle.
  const axisRef = useMemo(() => createAxisRef(axis, setAxisPx), [axis]);
  return { axisRef, axisPx };
}

function createAxisRef(axis, setAxisPx) {
  let observer = null;
  const ref = Object.assign(
    (node) => {
      observer?.disconnect();
      ref.current = node;
      if (!node) return;
      const measure = () => {
        const rect = node.getBoundingClientRect();
        const next = axis === "y" ? rect.height : rect.width;
        if (next > 0) setAxisPx(next);
      };
      measure();
      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver(measure);
        observer.observe(node);
      }
    },
    { current: null }
  );
  return ref;
}
