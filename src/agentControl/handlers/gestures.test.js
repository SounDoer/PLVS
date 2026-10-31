import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { gestureHandlers } from "./gestures.js";

function context(method, params, gestures) {
  const state = {
    uiNavigation: { getPanelGestures: (id) => (id === "spectrum" ? gestures : null) },
  };
  return /** @type {any} */ ({
    requestId: "request-1",
    request: { method, params },
    clock: createRevisionClock({ onWake: () => {} }),
    snap: state,
    live: () => state,
  });
}

describe("chart gesture commands", () => {
  it("clears Max Hold and resets TP Max through the panel's own gesture functions", async () => {
    const gestures = { clearMaxHold: vi.fn(), resetTruePeakMax: vi.fn() };
    await gestureHandlers["measurement.resetHold"].run(
      context("measurement.resetHold", { panelId: "spectrum", expectedRevision: 0 }, gestures)
    );
    await gestureHandlers["measurement.resetTruePeakMax"].run(
      context(
        "measurement.resetTruePeakMax",
        { panelId: "spectrum", expectedRevision: 0 },
        gestures
      )
    );
    expect(gestures.clearMaxHold).toHaveBeenCalledOnce();
    expect(gestures.resetTruePeakMax).toHaveBeenCalledOnce();
  });

  it("holds Slow Trace for the requested time and always releases it", async () => {
    vi.useFakeTimers();
    const holdSlow = { start: vi.fn(), stop: vi.fn() };
    const pending = gestureHandlers["panel.holdSlow"].run(
      context(
        "panel.holdSlow",
        { panelId: "spectrum", durationMs: 1500, expectedRevision: 0 },
        { holdSlow }
      )
    );
    expect(holdSlow.start).toHaveBeenCalledOnce();
    expect(holdSlow.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toMatchObject({ result: { durationMs: 1500 } });
    expect(holdSlow.stop).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("refuses a gesture the panel does not offer in its current mode, or a missing panel", async () => {
    await expect(
      gestureHandlers["measurement.resetHold"].run(
        context("measurement.resetHold", { panelId: "spectrum", expectedRevision: 0 }, {})
      )
    ).rejects.toMatchObject({ reason: "controlUnavailable" });
    await expect(
      gestureHandlers["measurement.resetHold"].run(
        context("measurement.resetHold", { panelId: "loudness", expectedRevision: 0 }, {})
      )
    ).rejects.toMatchObject({ reason: "panelNotFound" });
  });
});
