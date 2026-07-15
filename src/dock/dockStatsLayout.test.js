import { describe, expect, it } from "vitest";
import {
  computeDockStatsColumnCount,
  dockStatsGridPosition,
  dockStatsGridTemplate,
  DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX,
  DOCK_STATS_EXPANDED_COMFORTABLE_CELL_WIDTH_PX,
  DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX,
  DOCK_STATS_MAX_ROWS,
  DOCK_STATS_MIN_CELL_WIDTH_PX,
  visibleDockStats,
} from "./dockStatsLayout.js";

describe("computeDockStatsColumnCount", () => {
  it("adds columns only after accounting for the wider group gutters", () => {
    expect(DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX).toBe(72);
    expect(DOCK_STATS_MIN_CELL_WIDTH_PX).toBe(60);
    expect(computeDockStatsColumnCount(131)).toBe(1);
    expect(computeDockStatsColumnCount(132)).toBe(2);
    expect(computeDockStatsColumnCount(203)).toBe(2);
    expect(computeDockStatsColumnCount(204)).toBe(3);
  });

  it("supports wider Expanded metric cells", () => {
    expect(DOCK_STATS_EXPANDED_COMFORTABLE_CELL_WIDTH_PX).toBe(84);
    expect(DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX).toBe(72);
    expect(computeDockStatsColumnCount(155, undefined, DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX)).toBe(
      1
    );
    expect(computeDockStatsColumnCount(156, undefined, DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX)).toBe(
      2
    );
  });

  it("keeps at least one column for missing or invalid measurements", () => {
    expect(computeDockStatsColumnCount(0)).toBe(1);
    expect(computeDockStatsColumnCount(undefined)).toBe(1);
    expect(computeDockStatsColumnCount(200, -1)).toBe(1);
  });
});

describe("visibleDockStats", () => {
  it("caps row-major output at three rows without limiting the selection", () => {
    const metrics = Array.from({ length: 15 }, (_, id) => id);
    expect(DOCK_STATS_MAX_ROWS).toBe(3);
    expect(visibleDockStats(metrics, 2)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(visibleDockStats(metrics, 5)).toEqual(metrics);
  });
});

describe("dockStatsGridPosition", () => {
  it("keeps an incomplete final row on the shared three-row grid", () => {
    expect(dockStatsGridPosition(0, 6)).toEqual({ row: 1, cellColumn: 1 });
    expect(dockStatsGridPosition(5, 6)).toEqual({ row: 1, cellColumn: 11 });
    expect(dockStatsGridPosition(6, 6)).toEqual({ row: 2, cellColumn: 1 });
    expect(dockStatsGridPosition(11, 6)).toEqual({ row: 2, cellColumn: 11 });
    expect(dockStatsGridPosition(12, 6)).toEqual({ row: 3, cellColumn: 1 });
    expect(dockStatsGridPosition(14, 6)).toEqual({ row: 3, cellColumn: 5 });
  });
});

describe("dockStatsGridTemplate", () => {
  it("puts elastic space between metric groups instead of label and value", () => {
    expect(dockStatsGridTemplate(2)).toBe("minmax(0, 72px) minmax(12px, 1fr) minmax(0, 72px)");
  });

  it("accepts a tier-specific comfortable cell width", () => {
    expect(dockStatsGridTemplate(1, DOCK_STATS_EXPANDED_COMFORTABLE_CELL_WIDTH_PX)).toBe(
      "minmax(0, 84px)"
    );
  });
});
