import { describe, expect, it } from "vitest";
import {
  PLAYBACK_SILENCE_HOLD_MS,
  createChannelPlaybackMaxTracker,
  createPlaybackMaxTracker,
  hasPlaybackSignal,
  updateChannelPlaybackMax,
  updatePlaybackMax,
} from "./levelMeterPlaybackMax.js";

describe("hasPlaybackSignal", () => {
  it("needs a finite reading above the floor", () => {
    expect(hasPlaybackSignal([-Infinity, -80])).toBe(false);
    expect(hasPlaybackSignal([-80, -40])).toBe(true);
    expect(hasPlaybackSignal(-69)).toBe(true);
    expect(hasPlaybackSignal(Number.NaN)).toBe(false);
    expect(hasPlaybackSignal(undefined)).toBe(false);
  });
});

describe("updatePlaybackMax", () => {
  const frame = (overrides) => ({ enabled: true, mode: "momentary", audible: true, ...overrides });

  it("tracks the maximum during playback and ignores unavailable readings", () => {
    const tracker = createPlaybackMaxTracker("momentary");
    expect(updatePlaybackMax(tracker, frame({ value: -30, nowMs: 0 }))).toBe(-30);
    expect(updatePlaybackMax(tracker, frame({ value: -20, nowMs: 16 }))).toBe(-20);
    expect(updatePlaybackMax(tracker, frame({ value: -25, nowMs: 32 }))).toBe(-20);
    expect(updatePlaybackMax(tracker, frame({ value: Number.NaN, nowMs: 48 }))).toBe(-20);
  });

  it("holds through silence and restarts with the next playback", () => {
    const tracker = createPlaybackMaxTracker("momentary");
    updatePlaybackMax(tracker, frame({ value: -12, nowMs: 0 }));
    expect(updatePlaybackMax(tracker, frame({ audible: false, value: -60, nowMs: 100 }))).toBe(-12);
    // A short gap keeps the same playback.
    expect(updatePlaybackMax(tracker, frame({ value: -30, nowMs: 200 }))).toBe(-12);
    updatePlaybackMax(tracker, frame({ audible: false, value: -60, nowMs: 300 }));
    const held = updatePlaybackMax(
      tracker,
      frame({ audible: false, value: -60, nowMs: 300 + PLAYBACK_SILENCE_HOLD_MS })
    );
    expect(held).toBe(-12);
    // Silence lasted long enough: the next signal starts a new playback.
    expect(
      updatePlaybackMax(tracker, frame({ value: -30, nowMs: 301 + PLAYBACK_SILENCE_HOLD_MS }))
    ).toBe(-30);
  });

  it("clears when disabled or when the mode changes", () => {
    const tracker = createPlaybackMaxTracker("momentary");
    updatePlaybackMax(tracker, frame({ value: -12, nowMs: 0 }));
    expect(updatePlaybackMax(tracker, frame({ enabled: false, value: -12, nowMs: 16 }))).toBe(
      -Infinity
    );
    updatePlaybackMax(tracker, frame({ value: -12, nowMs: 32 }));
    expect(updatePlaybackMax(tracker, frame({ mode: "shortTerm", value: -18, nowMs: 48 }))).toBe(
      -18
    );
  });

  it("does not depend on rendering: frames alone drive it", () => {
    const tracker = createPlaybackMaxTracker("shortTerm");
    let last;
    for (let i = 0; i < 600; i++) {
      last = updatePlaybackMax(tracker, {
        enabled: true,
        mode: "shortTerm",
        audible: true,
        value: -30 + (i % 100) / 10,
        nowMs: i * 16,
      });
    }
    expect(last).toBeCloseTo(-20.1, 5);
  });
});

describe("updateChannelPlaybackMax", () => {
  const frame = (overrides) => ({ enabled: true, mode: "rms", ...overrides });

  it("tracks each channel separately", () => {
    const tracker = createChannelPlaybackMaxTracker("rms");
    expect(updateChannelPlaybackMax(tracker, frame({ values: [-30, -40], nowMs: 0 }))).toEqual([
      -30, -40,
    ]);
    expect(updateChannelPlaybackMax(tracker, frame({ values: [-35, -20], nowMs: 16 }))).toEqual([
      -30, -20,
    ]);
  });

  it("clears once silence has lasted the hold time", () => {
    const tracker = createChannelPlaybackMaxTracker("rms");
    updateChannelPlaybackMax(tracker, frame({ values: [-30, -40], nowMs: 0 }));
    expect(updateChannelPlaybackMax(tracker, frame({ values: [-90, -90], nowMs: 100 }))).toEqual([
      -30, -40,
    ]);
    expect(
      updateChannelPlaybackMax(
        tracker,
        frame({ values: [-90, -90], nowMs: 100 + PLAYBACK_SILENCE_HOLD_MS })
      )
    ).toEqual([]);
  });
});
