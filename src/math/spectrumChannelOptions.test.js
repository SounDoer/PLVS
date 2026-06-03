import { describe, expect, it } from "vitest";
import {
  buildSpectrumChannelOptions,
  clampSpectrumChannelToAvailable,
  defaultSpectrumChannel,
} from "./spectrumChannelOptions.js";

describe("buildSpectrumChannelOptions", () => {
  it("stereo (2ch): returns only L+R", () => {
    const opts = buildSpectrumChannelOptions(2, ["L", "R"]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({
      key: "p-0-1",
      label: "L+R",
      sel: { type: "pair", x: 0, y: 1 },
    });
  });

  it("5.1 (6ch): returns L+R, Ls+Rs, C, LFE", () => {
    const labels = ["L", "R", "C", "LFE", "Ls", "Rs"];
    const opts = buildSpectrumChannelOptions(6, labels);
    expect(opts.map((o) => o.key)).toEqual(["p-0-1", "p-4-5", "s-2", "s-3"]);
    expect(opts.map((o) => o.label)).toEqual(["L+R", "Ls+Rs", "C", "LFE"]);
    expect(opts[2].sel).toEqual({ type: "single", ch: 2 });
    expect(opts[3].sel).toEqual({ type: "single", ch: 3 });
  });

  it("7.1 (8ch): returns L+R, Ls+Rs, Lb+Rb, C, LFE", () => {
    const labels = ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"];
    const opts = buildSpectrumChannelOptions(8, labels);
    expect(opts.map((o) => o.key)).toEqual(["p-0-1", "p-4-5", "p-6-7", "s-2", "s-3"]);
    expect(opts[2].label).toBe("Lb+Rb");
  });

  it("unknown multichannel (4ch, generic labels): pairs (0,1) and (2,3), no singles", () => {
    const opts = buildSpectrumChannelOptions(4, ["Ch 1", "Ch 2", "Ch 3", "Ch 4"]);
    expect(opts.map((o) => o.key)).toEqual(["p-0-1", "p-2-3"]);
  });

  it("mono (1ch): returns empty", () => {
    expect(buildSpectrumChannelOptions(1, ["M"])).toHaveLength(0);
  });

  it("0ch: returns empty", () => {
    expect(buildSpectrumChannelOptions(0, [])).toHaveLength(0);
  });
});

describe("defaultSpectrumChannel", () => {
  it("returns pair 0-1", () => {
    expect(defaultSpectrumChannel()).toEqual({ type: "pair", x: 0, y: 1 });
  });
});

describe("clampSpectrumChannelToAvailable", () => {
  it("returns first option when sel is null", () => {
    const opts = buildSpectrumChannelOptions(6, ["L", "R", "C", "LFE", "Ls", "Rs"]);
    const result = clampSpectrumChannelToAvailable(null, opts);
    expect(result).toEqual({ type: "pair", x: 0, y: 1 });
  });

  it("returns sel when valid", () => {
    const opts = buildSpectrumChannelOptions(6, ["L", "R", "C", "LFE", "Ls", "Rs"]);
    const sel = { type: "single", ch: 2 };
    expect(clampSpectrumChannelToAvailable(sel, opts)).toEqual(sel);
  });

  it("falls back to first option when sel key is not in options", () => {
    const opts = buildSpectrumChannelOptions(2, ["L", "R"]);
    const sel = { type: "single", ch: 2 }; // not in 2ch options
    const result = clampSpectrumChannelToAvailable(sel, opts);
    expect(result).toEqual({ type: "pair", x: 0, y: 1 });
  });

  it("returns defaultSpectrumChannel when options is empty", () => {
    expect(clampSpectrumChannelToAvailable(null, [])).toEqual({ type: "pair", x: 0, y: 1 });
  });
});
