import { describe, it, expect } from "vitest";
import {
  SPECTRUM_VIEW_OPTIONS,
  spectrumViewApplies,
  spectrumViewLegend,
} from "./spectrumChannelViewOptions.js";

describe("spectrum view options", () => {
  it("exposes three view options", () => {
    expect(SPECTRUM_VIEW_OPTIONS.map((o) => o.key)).toEqual(["combined", "lr", "ms"]);
  });

  it("applies only to pair selections", () => {
    expect(spectrumViewApplies({ type: "pair", x: 0, y: 1 })).toBe(true);
    expect(spectrumViewApplies({ type: "single", ch: 2 })).toBe(false);
    expect(spectrumViewApplies(null)).toBe(false);
  });

  it("builds a two-entry legend for lr/ms, null otherwise", () => {
    const labels = ["L", "R", "C", "LFE", "Ls", "Rs"];
    expect(spectrumViewLegend("combined", { type: "pair", x: 0, y: 1 }, labels)).toBeNull();
    expect(spectrumViewLegend("ms", { type: "pair", x: 0, y: 1 }, labels)).toEqual([
      { token: "primary", label: "Mid" },
      { token: "secondary", label: "Side" },
    ]);
    expect(spectrumViewLegend("lr", { type: "pair", x: 4, y: 5 }, labels)).toEqual([
      { token: "primary", label: "Ls" },
      { token: "secondary", label: "Rs" },
    ]);
  });
});
