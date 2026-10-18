import { describe, expect, it } from "vitest";

import { desktopSurfaceFailure, MAX_VISIBLE_FRAME_GAP_MS } from "./soak-desktop.mjs";

function sample(runtime = {}) {
  return {
    runtime: {
      documentHidden: false,
      latestRafAgeMs: 10,
      rafGapMaxMs: 54,
      ...runtime,
    },
  };
}

describe("desktop soak surface validation", () => {
  it("accepts a visible renderer with fresh animation frames", () => {
    expect(desktopSurfaceFailure(sample())).toBeNull();
  });

  it("rejects a hidden renderer", () => {
    expect(desktopSurfaceFailure(sample({ documentHidden: true }))).toMatch(/hidden/);
  });

  it("rejects both a currently stale renderer and a recovered long pause", () => {
    expect(desktopSurfaceFailure(sample({ latestRafAgeMs: MAX_VISIBLE_FRAME_GAP_MS + 1 }))).toMatch(
      /stale/
    );
    expect(desktopSurfaceFailure(sample({ rafGapMaxMs: MAX_VISIBLE_FRAME_GAP_MS + 1 }))).toMatch(
      /maximum gap/
    );
  });

  it("does not invent a failure for unsupported animation metrics", () => {
    expect(desktopSurfaceFailure(sample({ latestRafAgeMs: null, rafGapMaxMs: null }))).toBeNull();
  });
});
