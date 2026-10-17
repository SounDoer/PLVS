import { describe, expect, it } from "vitest";

import {
  classifyWebViewProcess,
  parseMacProcessRows,
  selectMacPlvsProcesses,
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
    ).toEqual({
      ok: true,
      failures: [],
      phases: {
        normal: { ok: true, failures: [] },
        stalled: { ok: true, failures: [] },
        recovered: { ok: true, failures: [] },
      },
    });
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

  it("fails the phase where audio chunks were dropped", () => {
    const result = verifyBackpressurePhases({
      normalStart: diagnostics(),
      normalEnd: diagnostics({ sentFrames: 20 }),
      stalled: diagnostics({
        sentFrames: 140,
        droppedFrames: 20,
        audioDroppedChunks: 1,
        currentInflightFrames: 120,
        maxInflightFrames: 120,
      }),
      recovered: diagnostics({
        sentFrames: 160,
        droppedFrames: 20,
        audioDroppedChunks: 1,
        currentInflightFrames: 1,
        maxInflightFrames: 120,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.phases.stalled).toEqual({
      ok: false,
      failures: ["stall phase dropped audio chunks"],
    });
  });
});

describe("process classification", () => {
  it("distinguishes WebView2 renderer and GPU processes", () => {
    expect(classifyWebViewProcess("x --type=renderer --foo")).toBe("renderer");
    expect(classifyWebViewProcess("x --type=gpu-process --foo")).toBe("gpu");
    expect(classifyWebViewProcess("x --type=utility --foo")).toBe("utility");
    expect(classifyWebViewProcess("x --webview-exe-name=plvs.exe")).toBe("browser");
  });

  it("attributes only the host tree and WebKit processes with PLVS-owned paths on macOS", () => {
    const rows = parseMacProcessRows(`
      100 1 102400 00:01.50 /tmp/plvs
      101 100 1024 00:00.25 /tmp/helper
      200 1 204800 00:02.00 /System/Library/com.apple.WebKit.WebContent
      201 1 204800 00:03.00 /System/Library/com.apple.WebKit.WebContent
      202 1 51200 00:01.00 /System/Library/com.apple.WebKit.GPU
    `);
    const selected = selectMacPlvsProcesses(rows, 100, (pid) =>
      pid === 200 ? "/Users/test/Library/Caches/com.soundoer.plvs.dev/WebKit/NetworkCache" : ""
    );
    expect(selected).toEqual([
      expect.objectContaining({ pid: 100, kind: "host", workingSetMb: 100, cpuMs: 1500 }),
      expect.objectContaining({ pid: 101, kind: "child", workingSetMb: 1, cpuMs: 250 }),
      expect.objectContaining({ pid: 200, kind: "renderer", workingSetMb: 200, cpuMs: 2000 }),
    ]);
    expect(selected.some(({ pid }) => pid === 201 || pid === 202)).toBe(false);
  });
});

describe("summarizeDesktopSoak", () => {
  it("reports deltas and peaks without mistaking cumulative counters for per-sample values", () => {
    const sample = (t, sent, dropped, chunks, rss, heap, longTasks, rafGaps, loafs = []) => ({
      t,
      ui: diagnostics({
        sentFrames: sent,
        droppedFrames: dropped,
        audioDroppedChunks: chunks,
        maxInflightFrames: sent / 10,
      }),
      processes: [{ kind: "renderer", workingSetMb: rss, cpuMs: sent * 10 }],
      webview: { jsHeapUsedMb: heap },
      runtime: {
        longTasks,
        longTaskMaxMs: longTasks * 60,
        rafGaps,
        rafGapMaxMs: rafGaps * 70,
        longAnimationFrameSupported: true,
        longAnimationFrames: loafs,
      },
    });
    const summary = summarizeDesktopSoak([
      sample(0, 10, 2, 1, 100, 20, 1, 2),
      sample(10, 20, 5, 1, 112, 27, 3, 5, [
        { duration: 80, blockingDuration: 20, scripts: [{ sourceFunctionName: "paint" }] },
        { duration: 140, blockingDuration: 70, scripts: [{ sourceFunctionName: "commit" }] },
      ]),
    ]);
    expect(summary).toMatchObject({
      sampleCount: 2,
      uiDroppedFrames: 3,
      audioDroppedChunks: 0,
      workingSetGrowthMb: 12,
      jsHeapMaxMb: 27,
      currentInflightP95: 0,
      longTasks: 2,
      longAnimationFrameSupported: true,
      longAnimationFrames: 2,
      longAnimationFrameMaxMs: 140,
      longAnimationFrameMaxBlockingMs: 70,
      rafGaps: 3,
    });
    expect(summary.workingSetSecondHalfSlopeMbPerMin).toBe(0);
    expect(summary.workingSetSlopeAfterWarmupMbPerMin).toBeCloseTo(72);
    expect(summary.processGrowthMbByKind).toEqual({ renderer: 12 });
    expect(summary.worstLongAnimationFrames[0].scripts[0].sourceFunctionName).toBe("commit");
  });

  it("keeps unavailable WKWebView metrics null instead of manufacturing zeroes", () => {
    const sample = (t, sent) => ({
      t,
      ui: diagnostics({ sentFrames: sent }),
      processes: [{ kind: "host", workingSetMb: 100 + t, cpuMs: sent }],
      webview: { jsHeapUsedMb: null },
      runtime: {
        longTasks: null,
        longTaskMaxMs: null,
        rafGaps: null,
        rafGapMaxMs: 20 + t,
        longAnimationFrameSupported: false,
        longAnimationFrames: [],
      },
    });
    expect(summarizeDesktopSoak([sample(0, 1), sample(10, 2)])).toMatchObject({
      jsHeapStartMb: null,
      jsHeapEndMb: null,
      jsHeapMaxMb: null,
      jsHeapSlopeAfterWarmupMbPerMin: null,
      longTasks: null,
      longTaskMaxMs: null,
      rafGaps: null,
      rafGapMaxMs: 30,
    });
  });
});
