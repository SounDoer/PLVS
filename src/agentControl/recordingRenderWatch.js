/**
 * How long without an animation frame before an active recording counts as stalled. A covered or
 * hidden WebView stops producing frames; the recording then repeats its last picture.
 */
export const RECORDING_STALL_MS = 500;
/** How often the watch also asks whether the native window is minimized. */
export const RECORDING_WATCH_INTERVAL_MS = 250;

/**
 * Watches whether the captured PLVS view keeps drawing during a recording and reports each change.
 * The view counts as stalled while the page is hidden, no animation frame has arrived for
 * `stallMs`, or the native window is minimized (some WebViews keep drawing while minimized, but
 * window capture then receives no pictures). It never reveals or raises the window: mid-recording,
 * the user's window arrangement wins.
 *
 * @param {{
 *   report: (rendering: boolean) => unknown,
 *   isMinimized?: () => Promise<boolean> | boolean,
 *   windowObject?: Window & typeof globalThis,
 *   documentObject?: Document,
 *   now?: () => number,
 *   stallMs?: number,
 *   intervalMs?: number,
 * }} options
 * @returns {() => void} Stops the watch.
 */
export function watchRecordingRender({
  report,
  isMinimized = () => false,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  now = () => Date.now(),
  stallMs = RECORDING_STALL_MS,
  intervalMs = RECORDING_WATCH_INTERVAL_MS,
}) {
  let stopped = false;
  let rendering = true;
  let minimized = false;
  let lastFrame = now();
  let frame = 0;
  let checking = false;

  const update = () => {
    if (stopped) return;
    const next =
      !minimized && documentObject.visibilityState === "visible" && now() - lastFrame < stallMs;
    if (next === rendering) return;
    rendering = next;
    Promise.resolve()
      .then(() => report(next))
      .catch(() => {});
  };
  const onFrame = () => {
    if (stopped) return;
    lastFrame = now();
    update();
    frame = windowObject.requestAnimationFrame(onFrame);
  };
  const check = async () => {
    if (checking || stopped) return;
    checking = true;
    try {
      minimized = (await isMinimized()) === true;
    } catch {
      minimized = false;
    } finally {
      checking = false;
    }
    update();
  };

  frame = windowObject.requestAnimationFrame(onFrame);
  const interval = windowObject.setInterval(() => void check(), intervalMs);
  documentObject.addEventListener("visibilitychange", update);
  return () => {
    stopped = true;
    windowObject.cancelAnimationFrame(frame);
    windowObject.clearInterval(interval);
    documentObject.removeEventListener("visibilitychange", update);
  };
}
