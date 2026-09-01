import { describe, expect, it } from "vitest";

import { parseRigArgs } from "./desktop-perf-rig.mjs";

describe("parseRigArgs", () => {
  it("parses the shared desktop performance options", () => {
    const options = parseRigArgs([
      "--port=9333",
      "--scenario",
      "heavy",
      "--seconds",
      "60",
      "--every=5",
      "--browser-args=--disable-gpu",
    ]);
    expect(options).toMatchObject({
      port: 9333,
      scenario: "heavy",
      seconds: 60,
      every: 5,
      browserArgs: "--disable-gpu",
    });
  });

  it("rejects an unknown scenario and non-positive timing", () => {
    expect(() => parseRigArgs(["--scenario", "unknown"])).toThrow(/scenario/);
    expect(() => parseRigArgs(["--seconds", "0"])).toThrow(/positive/);
  });
});
