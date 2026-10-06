/**
 * Calls `onChange` whenever devicePixelRatio changes; returns a disposer.
 *
 * A canvas backing store follows DPR, but a ResizeObserver only reports CSS size, and DPR can change
 * while the CSS size stays put: dragging the window to a monitor with a different scale, or changing
 * Windows text scaling. A `resolution` media query matching the current ratio stops matching the
 * moment the ratio moves, so it is re-armed at the new ratio after every change.
 */
/**
 * Calls `onChange` whenever devicePixelRatio changes; returns a disposer.
 *
 * A canvas backing store follows DPR, but a ResizeObserver only reports CSS size, and DPR can change
 * while the CSS size stays put: dragging the window to a monitor with a different scale, or changing
 * Windows text scaling. A `resolution` media query matching the current ratio stops matching the
 * moment the ratio moves, so it is re-armed at the new ratio after every change.
 */
export function watchDevicePixelRatio(onChange) {
  if (typeof globalThis.matchMedia !== "function") return () => {};
  let mql = null;
  const listener = () => {
    arm();
    onChange();
  };
  function arm() {
    mql?.removeEventListener("change", listener);
    mql = globalThis.matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
    mql.addEventListener("change", listener);
  }
  arm();
  return () => mql.removeEventListener("change", listener);
}
