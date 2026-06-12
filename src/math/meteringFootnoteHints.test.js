import { describe, expect, it } from "vitest";
import { buildMeteringFootnoteHints, STAT_ROW_HINTS } from "./meteringFootnoteHints.js";

describe("buildMeteringFootnoteHints", () => {
  it("returns nothing when not running", () => {
    expect(
      buildMeteringFootnoteHints({ running: false, channelLayout: "5.1", channelCount: 2 })
    ).toEqual([]);
  });

  it("returns nothing when channel count is zero", () => {
    expect(
      buildMeteringFootnoteHints({ running: true, channelLayout: "stereo", channelCount: 0 })
    ).toEqual([]);
  });

  it("warns for auto + unknown multichannel layouts", () => {
    const h = buildMeteringFootnoteHints({ running: true, channelLayout: "auto", channelCount: 3 });
    expect(h.map((x) => x.id)).toContain("layout-auto-unknown-multichannel");
  });

  it("does not warn for auto-detected 5.1 or 7.1 layouts", () => {
    expect(
      buildMeteringFootnoteHints({ running: true, channelLayout: "auto", channelCount: 6 })
    ).toEqual([]);
    expect(
      buildMeteringFootnoteHints({ running: true, channelLayout: "auto", channelCount: 8 })
    ).toEqual([]);
  });

  it("warns for manual 5.1 with fewer than six channels", () => {
    const h = buildMeteringFootnoteHints({ running: true, channelLayout: "5.1", channelCount: 2 });
    expect(h.map((x) => x.id)).toEqual(["layout-manual-51-insufficient-channels"]);
    expect(h[0].message).toContain("2 ch");
  });

  it("warns for manual 7.1 with fewer than eight channels", () => {
    const h = buildMeteringFootnoteHints({ running: true, channelLayout: "7.1", channelCount: 6 });
    expect(h.map((x) => x.id)).toEqual(["layout-manual-71-insufficient-channels"]);
    expect(h[0].message).toContain("6 ch");
  });

  it("warns for manual stereo with more than two channels", () => {
    const h = buildMeteringFootnoteHints({
      running: true,
      channelLayout: "stereo",
      channelCount: 6,
    });
    expect(h.map((x) => x.id)).toEqual(["layout-manual-stereo-surplus-channels"]);
    expect(h[0].message).toContain("6 ch");
  });

  it("emits no manual mismatch hints when stereo stream matches stereo preset", () => {
    expect(
      buildMeteringFootnoteHints({ running: true, channelLayout: "stereo", channelCount: 2 })
    ).toEqual([]);
  });

  it("emits no manual mismatch hints when six-channel stream matches 5.1 preset", () => {
    expect(
      buildMeteringFootnoteHints({ running: true, channelLayout: "5.1", channelCount: 6 })
    ).toEqual([]);
  });

  it("emits no manual mismatch hints when eight-channel stream matches 7.1 preset", () => {
    expect(
      buildMeteringFootnoteHints({ running: true, channelLayout: "7.1", channelCount: 8 })
    ).toEqual([]);
  });

  it("includes a hint for each dialogue stat id that mentions singing", () => {
    for (const id of [
      "dialogueCoverage",
      "dialogueIntegrated",
      "dialogueRange",
      "dialogueOffset",
    ]) {
      expect(STAT_ROW_HINTS[id]).toContain("singing");
    }
  });
});
