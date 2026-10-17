import { describe, expect, it } from "vitest";
import {
  boundedMainThreadStall,
  createDevelopmentPerformanceProbe,
} from "./developmentPerformanceProbe.js";

describe("development performance probe", () => {
  it("samples continuous animation-frame progress and freshness synchronously", () => {
    const callbacks = new Map();
    let nextHandle = 1;
    let nowMs = 10;
    const probe = createDevelopmentPerformanceProbe({
      requestFrame: (callback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => callbacks.delete(handle),
      now: () => nowMs,
      countDomNodes: () => 42,
    });

    probe.start();
    callbacks.get(1)(10);
    callbacks.get(2)(28);
    nowMs = 35;

    expect(probe.snapshot()).toEqual({
      capabilities: {
        animationFrame: true,
        domNodeCount: true,
        jsHeap: false,
        longAnimationFrame: false,
        longTask: false,
      },
      animationFrame: { count: 2, latestAgeMs: 7, maxGapMs: 18 },
      domNodeCount: 42,
    });
    probe.stop();
    expect(callbacks.has(3)).toBe(false);
  });

  it("reports animation frames as unsupported when no scheduler exists", () => {
    const probe = createDevelopmentPerformanceProbe({
      requestFrame: undefined,
      now: () => 25,
      countDomNodes: () => 3,
    });
    probe.start();
    expect(probe.snapshot()).toMatchObject({
      capabilities: { animationFrame: false },
      animationFrame: { count: 0, latestAgeMs: null, maxGapMs: null },
      domNodeCount: 3,
    });
  });

  it("returns the measured duration of a bounded synchronous stall", () => {
    let value = 0;
    const result = boundedMainThreadStall(4, () => value++);
    expect(result).toEqual({ requestedMs: 4, elapsedMs: 4 });
  });
});
