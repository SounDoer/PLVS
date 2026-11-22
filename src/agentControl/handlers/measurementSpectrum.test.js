import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { measurementHandlers } from "./measurement.js";

function context(params, { readout = null, moduleId = "spectrum" } = {}) {
  const state = {
    workspace: { panelsById: { "panel-1": { moduleId } } },
    uiNavigation: { getPanelReadout: (id) => (id === "panel-1" ? readout : null) },
    measurementContext: {
      liveState: "running",
      getLiveMeasurement: () => ({ generation: 2, record: { sequence: 9 } }),
    },
  };
  return /** @type {any} */ ({
    requestId: "request-1",
    request: { method: "measurement.spectrum", params },
    clock: createRevisionClock({ onWake: () => {} }),
    snap: state,
    live: () => state,
  });
}

const run = measurementHandlers["measurement.spectrum"].run;

describe("measurement spectrum", () => {
  it("reads the panel's own render, at the requested resolution", async () => {
    const centers = Array.from({ length: 961 }, (_, index) => 20 * 2 ** (index / 96));
    const read = vi.fn(() => ({
      displaySource: "live",
      frame: { sequence: 9, elapsedMs: 100, receivedAtMs: Date.now() },
      centers,
      curveDb: centers.map(() => -30),
      display: { maxMode: "off" },
    }));
    const { result } = await run(
      context({ panelId: "panel-1", resolution: "octave" }, { readout: { read } })
    );
    expect(read).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      panelId: "panel-1",
      source: { sessionGeneration: 2 },
      sample: { sequence: 9, freshness: "fresh" },
      resolution: "octave",
    });
    expect(result.bands).toHaveLength(11);
  });

  it("refuses a missing, non-Spectrum, or unrendered panel", async () => {
    await expect(run(context({ panelId: "nope" }))).rejects.toMatchObject({
      reason: "panelNotFound",
    });
    await expect(
      run(context({ panelId: "panel-1" }, { moduleId: "vectorscope", readout: { read() {} } }))
    ).rejects.toMatchObject({ reason: "controlUnavailable" });
    // An inactive tab registers nothing; a non-readout registration is an empty controller.
    for (const readout of [null, {}]) {
      await expect(run(context({ panelId: "panel-1" }, { readout }))).rejects.toMatchObject({
        reason: "panelNotFound",
      });
    }
  });

  it("answers outside the serialized queue, like the reads beside it", () => {
    expect(measurementHandlers["measurement.spectrum"].lane).toBe("direct");
  });
});
