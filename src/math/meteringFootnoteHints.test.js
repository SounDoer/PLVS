import { describe, expect, it } from "vitest";
import { buildMeteringFootnoteHints } from "./meteringFootnoteHints.js";

describe("buildMeteringFootnoteHints", () => {
  it("returns nothing when not running", () => {
    expect(buildMeteringFootnoteHints({ running: false, channelLayout: "5.1", channelCount: 2 })).toEqual([]);
  });

  it("returns nothing when channel count is zero", () => {
    expect(buildMeteringFootnoteHints({ running: true, channelLayout: "stereo", channelCount: 0 })).toEqual([]);
  });

  it("warns for auto + multichannel", () => {
    const h = buildMeteringFootnoteHints({ running: true, channelLayout: "auto", channelCount: 6 });
    expect(h.map((x) => x.id)).toContain("layout-auto-unknown-multichannel");
  });

  it("warns for manual 5.1 with fewer than six channels", () => {
    const h = buildMeteringFootnoteHints({ running: true, channelLayout: "5.1", channelCount: 2 });
    expect(h.map((x) => x.id)).toEqual(["layout-manual-51-insufficient-channels"]);
    expect(h[0].message).toContain("2 ch");
  });

  it("warns for manual stereo with more than two channels", () => {
    const h = buildMeteringFootnoteHints({ running: true, channelLayout: "stereo", channelCount: 6 });
    expect(h.map((x) => x.id)).toEqual(["layout-manual-stereo-surplus-channels"]);
    expect(h[0].message).toContain("6 ch");
  });

  it("emits no manual mismatch hints when stereo stream matches stereo preset", () => {
    expect(buildMeteringFootnoteHints({ running: true, channelLayout: "stereo", channelCount: 2 })).toEqual([]);
  });

  it("emits no manual mismatch hints when six-channel stream matches 5.1 preset", () => {
    expect(buildMeteringFootnoteHints({ running: true, channelLayout: "5.1", channelCount: 6 })).toEqual([]);
  });
});
