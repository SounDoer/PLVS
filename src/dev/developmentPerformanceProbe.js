const OPTIONAL_BROWSER_CAPABILITIES = Object.freeze({
  jsHeap: false,
  longAnimationFrame: false,
  longTask: false,
});

/**
 * Continuously observes renderer progress without making a diagnostic request wait for the next
 * animation frame. The caller owns start/stop so tests can supply a deterministic scheduler.
 */
export function createDevelopmentPerformanceProbe({
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  now = () => globalThis.performance.now(),
  countDomNodes = () => globalThis.document?.getElementsByTagName("*").length ?? 0,
} = {}) {
  const supported = typeof requestFrame === "function";
  let active = false;
  let handle = null;
  let frameCount = 0;
  let latestFrameAtMs = null;
  let maxFrameGapMs = null;

  const onFrame = (timestamp) => {
    if (!active) return;
    if (latestFrameAtMs !== null) {
      const gap = Math.max(0, timestamp - latestFrameAtMs);
      maxFrameGapMs = maxFrameGapMs === null ? gap : Math.max(maxFrameGapMs, gap);
    }
    latestFrameAtMs = timestamp;
    frameCount += 1;
    handle = requestFrame(onFrame);
  };

  return {
    start() {
      if (!supported || active) return;
      active = true;
      handle = requestFrame(onFrame);
    },
    stop() {
      active = false;
      if (handle !== null && typeof cancelFrame === "function") cancelFrame(handle);
      handle = null;
    },
    snapshot() {
      const sampledAtMs = now();
      return {
        capabilities: {
          animationFrame: supported,
          domNodeCount: true,
          ...OPTIONAL_BROWSER_CAPABILITIES,
        },
        animationFrame: {
          count: frameCount,
          latestAgeMs: latestFrameAtMs === null ? null : Math.max(0, sampledAtMs - latestFrameAtMs),
          maxGapMs: maxFrameGapMs,
        },
        domNodeCount: countDomNodes(),
      };
    },
  };
}

export function boundedMainThreadStall(milliseconds, now = () => globalThis.performance.now()) {
  const startedAtMs = now();
  let endedAtMs;
  do {
    endedAtMs = now();
  } while (endedAtMs - startedAtMs < milliseconds);
  return { requestedMs: milliseconds, elapsedMs: endedAtMs - startedAtMs };
}
