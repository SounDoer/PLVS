import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { normalizeAgentControlRequest } from "../protocol.js";
import { interpolate, paced } from "./paced.js";

describe("paced changes", () => {
  it("interpolates numbers linearly, frequencies geometrically and integers as integers", () => {
    expect(interpolate(0, 10, 0.5)).toBe(5);
    expect(interpolate(100, 10000, 0.5, "minHz")).toBeCloseTo(1000);
    expect(interpolate(2, 7, 0.5)).toBe(5);
    expect(interpolate({ a: 0, mode: "x" }, { a: 4, mode: "y" }, 0.5)).toEqual({ a: 2, mode: "x" });
    expect(interpolate({ a: 0, mode: "x" }, { a: 4, mode: "y" }, 1)).toEqual({ a: 4, mode: "y" });
  });

  it("applies evenly spaced steps through the handler and ends exactly on the request", async () => {
    vi.useFakeTimers();
    const clock = createRevisionClock({ onWake: () => {} });
    const seen = [];
    const run = vi.fn(async (ctx) => {
      seen.push({ ...ctx.request.params });
      clock.bump();
      return { requestId: "r", result: { revision: clock.current() } };
    });
    const inputs = { transport: { snapshot: { offsetSec: 0 } } };
    const pending = paced(run)({
      requestId: "r",
      request: {
        method: "transport.snapshot.select",
        params: { offsetSec: 30, expectedRevision: 0, steps: 3, durationMs: 300 },
      },
      clock,
      snap: inputs,
      live: () => inputs,
    });
    await vi.advanceTimersByTimeAsync(300);
    const response = await pending;
    vi.useRealTimers();

    expect(seen).toEqual([
      { offsetSec: 10, expectedRevision: 0 },
      { offsetSec: 20, expectedRevision: 1 },
      { offsetSec: 30, expectedRevision: 2 },
    ]);
    expect(response.result).toMatchObject({ steps: 3, durationMs: 300, revision: 3 });
  });

  it("runs a request without steps unchanged", async () => {
    const run = vi.fn(async (/** @type {any} */ _ctx) => ({ result: {} }));
    await paced(run)(
      /** @type {any} */ ({
        request: {
          method: "panel.update",
          params: { panelId: "a", patch: {}, expectedRevision: 0 },
        },
        clock: createRevisionClock({ onWake: () => {} }),
        snap: {},
        live: () => ({}),
      })
    );
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0].request.params).toEqual({
      panelId: "a",
      patch: {},
      expectedRevision: 0,
    });
  });

  it("validates steps and duration around each method's own validation", () => {
    const request = (params) => ({
      jsonrpc: "2.0",
      id: "1",
      method: "transport.snapshot.select",
      params: { offsetSec: 4, expectedRevision: 0, ...params },
    });
    expect(normalizeAgentControlRequest(request({ steps: 5, durationMs: 400 }))).toMatchObject({
      ok: true,
      request: { params: { offsetSec: 4, steps: 5, durationMs: 400 } },
    });
    for (const invalid of [
      { steps: 1 },
      { steps: 61 },
      { durationMs: 100 },
      { steps: 3, dryRun: true },
    ]) {
      expect(normalizeAgentControlRequest(request(invalid))).toMatchObject({ ok: false });
    }
  });
});
