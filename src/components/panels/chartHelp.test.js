import { describe, expect, it } from "vitest";

import { PANEL_HELP_BY_MODULE_ID } from "./chartHelp.js";

describe("vectorscope panel help", () => {
  it("resolves gestures from the active vectorscope mode", () => {
    const resolveHelp = PANEL_HELP_BY_MODULE_ID.vectorscope;

    expect(typeof resolveHelp).toBe("function");
    expect(resolveHelp({ vectorscopeMode: "lissajous" })[0].items).toEqual([
      "Left hold - Slow trace decay",
    ]);
    expect(resolveHelp({ vectorscopeMode: "polarSample" })).toBeNull();
    expect(
      resolveHelp({
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelPeakHold: true,
      })[0].items
    ).toEqual(["Click plot - Reset Peak hold"]);
    expect(
      resolveHelp({
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelPeakHold: false,
      })
    ).toBeNull();
  });
});
