import { describe, expect, it } from "vitest";
import { formatClock } from "./useSessionTimer.js";

describe("formatClock", () => {
  it("formats sub-hour durations as HH:MM:SS", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(8_000)).toBe("00:00:08");
    expect(formatClock(12_345)).toBe("00:00:12");
    expect(formatClock(12 * 60_000 + 3_000)).toBe("00:12:03");
  });

  it("formats hour-long durations without changing shape", () => {
    expect(formatClock(3_661_000)).toBe("01:01:01");
  });
});
