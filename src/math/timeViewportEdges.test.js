import { describe, expect, it } from "vitest";
import { edgesFromViewport, viewportFromEdges } from "./timeViewportEdges";
import { getHistoryViewport, mediaTimeAxisRangeSec } from "./historyMath";

const SAMPLE_SEC = 0.1;

// The settings row must read what the rail reads, so these fixtures go through the same viewport
// derivation the axis labels do rather than restating window/offset by hand.
function viewport(windowSec, offsetSec, totalSamples, maxWindowSec = 7200) {
  const derived = getHistoryViewport(totalSamples, windowSec, offsetSec, SAMPLE_SEC, maxWindowSec);
  return {
    totalSamples,
    sampleSec: SAMPLE_SEC,
    visibleSamples: derived.visibleSamples,
    effectiveOffsetSamples: derived.effectiveOffsetSamples,
  };
}

describe("edgesFromViewport, live", () => {
  it("counts down from the left, matching the time-ago labels", () => {
    expect(edgesFromViewport({ sourceMode: "live", ...viewport(30, 0, 600) })).toEqual({
      left: 30,
      right: 0,
    });
  });

  it("carries the offset on both ends", () => {
    expect(edgesFromViewport({ sourceMode: "live", ...viewport(20, 10, 600) })).toEqual({
      left: 30,
      right: 10,
    });
  });
});

describe("edgesFromViewport, file", () => {
  it("counts up from the left, matching the media-time labels", () => {
    const v = viewport(30, 0, 600);
    const { startSec, endSec } = mediaTimeAxisRangeSec(
      v.totalSamples,
      v.effectiveOffsetSamples,
      v.visibleSamples,
      SAMPLE_SEC
    );

    expect(edgesFromViewport({ sourceMode: "file", ...v })).toEqual({
      left: Math.round(startSec),
      right: Math.round(endSec),
    });
  });

  it("puts the earlier media time on the left, the reverse of live", () => {
    const edges = edgesFromViewport({ sourceMode: "file", ...viewport(30, 10, 600) });

    expect(edges.left).toBeLessThan(edges.right);
  });
});

describe("viewportFromEdges", () => {
  it("round-trips a live viewport", () => {
    const v = viewport(20, 10, 600);
    const edges = edgesFromViewport({ sourceMode: "live", ...v });

    expect(viewportFromEdges({ ...edges, sourceMode: "live", ...v })).toEqual({
      windowSec: 20,
      offsetSec: 10,
    });
  });

  it("round-trips a file viewport to within the sample the labels round away", () => {
    // The row shows whole seconds, so a viewport that does not land on one comes back off by up to
    // a sample. What matters is that it does not then keep drifting -- see the stability check.
    const v = viewport(20, 10, 600);
    const edges = edgesFromViewport({ sourceMode: "file", ...v });
    const back = viewportFromEdges({ ...edges, sourceMode: "file", ...v });

    expect(back.windowSec).toBeCloseTo(20, 5);
    expect(Math.abs(back.offsetSec - 10)).toBeLessThanOrEqual(SAMPLE_SEC);
  });

  it("settles after one file round trip instead of drifting a sample at a time", () => {
    let current = { windowSec: 20, offsetSec: 10 };
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const v = viewport(current.windowSec, current.offsetSec, 600);
      const edges = edgesFromViewport({ sourceMode: "file", ...v });
      current = viewportFromEdges({ ...edges, sourceMode: "file", ...v });
      seen.push(current.offsetSec);
    }

    expect(seen[3]).toBeCloseTo(seen[1], 10);
  });

  it("swaps ends given the wrong way round rather than making a negative window", () => {
    const v = viewport(30, 0, 600);
    const swapped = viewportFromEdges({ left: 0, right: 30, sourceMode: "live", ...v });

    expect(swapped.windowSec).toBeGreaterThan(0);
    expect(swapped).toEqual(viewportFromEdges({ left: 30, right: 0, sourceMode: "live", ...v }));
  });
});

describe("viewportFromEdges clamps against the current source", () => {
  it("holds a live window inside the retention setting", () => {
    const v = viewport(30, 0, 600);
    const tooLong = viewportFromEdges({
      left: 9000,
      right: 0,
      sourceMode: "live",
      ...v,
      maxWindowSec: 300,
    });

    expect(tooLong.windowSec).toBe(300);
  });

  it("holds a file window inside the recording", () => {
    // 600 samples at 0.1s is a 60 second file; asking for 120 cannot be honoured.
    const v = viewport(30, 0, 600);
    const tooLong = viewportFromEdges({ left: 0, right: 120, sourceMode: "file", ...v });

    expect(tooLong.windowSec).toBeLessThanOrEqual(60);
  });

  it("holds the window at the floor", () => {
    const v = viewport(30, 0, 600);
    const tooShort = viewportFromEdges({ left: 1, right: 0, sourceMode: "live", ...v });

    expect(tooShort.windowSec).toBe(5);
  });

  it("holds the offset inside the data that exists", () => {
    const v = viewport(30, 0, 600);
    const tooFar = viewportFromEdges({ left: 9000, right: 8970, sourceMode: "live", ...v });

    // 60 seconds of history minus a 30 second window leaves 30 seconds to scroll back through.
    expect(tooFar.offsetSec).toBeCloseTo(30, 5);
  });

  it("is idempotent", () => {
    const v = viewport(30, 0, 600);
    const once = viewportFromEdges({ left: 9000, right: 0, sourceMode: "live", ...v });
    const onceEdges = edgesFromViewport({
      sourceMode: "live",
      ...viewport(once.windowSec, once.offsetSec, 600),
    });
    const twice = viewportFromEdges({ ...onceEdges, sourceMode: "live", ...v });

    expect(twice).toEqual(once);
  });
});
