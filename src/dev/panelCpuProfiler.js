let enabled = false;
let samples = new Map();

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function setPanelCpuProfilerEnabled(nextEnabled) {
  enabled = nextEnabled === true;
}

export function resetPanelCpuProfiler() {
  samples = new Map();
}

export function isPanelCpuProfilerEnabled() {
  return enabled;
}

export function beginPanelCpuSample() {
  return enabled ? now() : null;
}

export function recordPanelCpuEvent(family, event, elapsedMs = 0) {
  if (!enabled) return;
  const key = `${family}:${event}`;
  const current = samples.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
  const duration = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  current.count += 1;
  current.totalMs += duration;
  current.maxMs = Math.max(current.maxMs, duration);
  samples.set(key, current);
}

export function finishPanelCpuSample(family, event, startedAt) {
  if (!enabled || !Number.isFinite(startedAt)) return;
  recordPanelCpuEvent(family, event, now() - startedAt);
}

export function snapshotPanelCpuProfiler() {
  const result = {};
  for (const [key, value] of samples) result[key] = { ...value };
  return result;
}

export const panelCpuProfiler = Object.freeze({
  enable() {
    setPanelCpuProfilerEnabled(true);
  },
  disable() {
    setPanelCpuProfilerEnabled(false);
  },
  reset: resetPanelCpuProfiler,
  snapshot: snapshotPanelCpuProfiler,
  get enabled() {
    return enabled;
  },
});

// DevTools workflow: enable, reset, interact for a fixed interval, then snapshot. The module is
// already imported by the instrumented renderers, so exposing this stable controller does not
// install a timer, observer, or React subscription of its own.
//
// Attached in release builds too, and on purpose. Renderer profiling runs against a release build
// -- a development one is unminified and carries React's development runtime, which is not the
// thing anyone needs measured -- so a DEV-only gate would keep the instrument out of the only
// place it can answer anything. Counting is off until something turns it on.
if (typeof window !== "undefined") {
  window.__PLVS_PANEL_CPU__ = panelCpuProfiler;
}
