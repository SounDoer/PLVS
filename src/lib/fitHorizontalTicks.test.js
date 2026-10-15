import { expect, it } from "vitest";
import { fitHorizontalTicks } from "./fitHorizontalTicks.js";
const ticks = [0, -50, -64].map((key) => ({ key, frac: (key + 64) / 64 }));
it("protects inset endpoint text from nearby horizontal ticks", () => {
  expect(fitHorizontalTicks(ticks, 128, 24, 6).map((t) => t.key)).toEqual([0, -64]);
});
it("restores interior ticks when the track has enough room", () => {
  expect(fitHorizontalTicks(ticks, 320, 24, 6)).toEqual(ticks);
});
