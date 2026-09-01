import { describe, expect, it } from "vitest";

import {
  classifyWebViewProcess,
  summarizeDesktopSoak,
  verifyBackpressurePhases,
} from "./webview-observability.mjs";

const diagnostics = (overrides = {}) => ({
  sentFrames: 0,
  droppedFrames: 0,
  audioDroppedChunks: 0,
  currentInflightFrames: 0,
  maxInflightFrames: 1,
  inflightLimit: 120,
  ...overrides,
});

describe("verifyBackpressurePhases", () => {
  it("accepts normal flow, a visible capped stall, and recovery", () => {
    expect(
      verifyBackpressurePhases({
        normalStart: diagnostics(),
        normalEnd: diagnostics({ sentFrames: 20 }),
        stalled: diagnostics({
          sentFrames: 140,
          droppedFrames: 20,
          currentInflightFrames: 120,
          maxInflightFrames: 120,
        }),
        recovered: diagnostics({
          sentFrames: 160,
          droppedFrames: 20,
          currentInflightFrames: 1,
          maxInflightFrames: 120,
        }),
      })
    ).toEqual({ ok: true, failures: [] });
  });

  it("rejects a stall that remained invisible", () => {
    const result = verifyBackpressurePhases({
      normalStart: diagnostics(),
      normalEnd: diagnostics({ sentFrames: 10 }),
      stalled: diagnostics({ sentFrames: 10 }),
      recovered: diagnostics({ sentFrames: 10 }),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/observable UI frame drop/);
  });
});

describe("process classification", () => {
  it("distinguishes WebView2 renderer and GPU processes", () => {
    expect(classifyWebViewProcess("x --type=renderer --foo")).toBe("renderer");
    expect(classifyWebViewProcess("x --type=gpu-process --foo")).toBe("gpu");
    expect(classifyWebViewProcess("x --type=utility --foo")).toBe("utility");
    expect(classifyWebViewProcess("x --webview-exe-name=plvs.exe")).toBe("browser");
  });
});

describe("summarizeDesktopSoak", () => {
  it("reports deltas and peaks without mistaking cumulative counters for per-sample values", () => {
    const sample = (t, sent, dropped, chunks, rss, heap, longTasks, rafGaps) => ({
      t,
      ui: diagnostics({
        sentFrames: sent,
        droppedFrames: dropped,
        audioDroppedChunks: chunks,
        maxInflightFrames: sent / 10,
      }),
      processes: [{ kind: "renderer", workingSetMb: rss, cpuMs: sent * 10 }],
      webview: { jsHeapUsedMb: heap },
      runtime: { longTasks, longTaskMaxMs: longTasks * 60, rafGaps, rafGapMaxMs: rafGaps * 70 },
    });
    const summary = summarizeDesktopSoak([
      sample(0, 10, 2, 1, 100, 20, 1, 2),
      sample(10, 20, 5, 1, 112, 27, 3, 5),
    ]);
    expect(summary).toMatchObject({
      sampleCount: 2,
      uiDroppedFrames: 3,
      audioDroppedChunks: 0,
      workingSetGrowthMb: 12,
      jsHeapMaxMb: 27,
      currentInflightP95: 0,
      longTasks: 2,
      rafGaps: 3,
    });
    expect(summary.workingSetSecondHalfSlopeMbPerMin).toBe(0);
    expect(summary.workingSetSlopeAfterWarmupMbPerMin).toBeCloseTo(72);
    expect(summary.processGrowthMbByKind).toEqual({ renderer: 12 });
  });
});
