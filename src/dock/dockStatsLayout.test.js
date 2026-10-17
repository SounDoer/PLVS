import { describe, expect, it } from "vitest";
import {
  computeDockStatsColumnCount,
  dockStatsGridPosition,
  dockStatsGridTemplate,
  DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX,
  fitDockStatsColumns,
  DOCK_STATS_MIN_CELL_WIDTH_PX,
  visibleDockStats,
} from "./dockStatsLayout.js";

describe("computeDockStatsColumnCount", () => {
  it("adds columns only after accounting for the wider group gutters", () => {
    expect(DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX).toBe(92);
    expect(DOCK_STATS_MIN_CELL_WIDTH_PX).toBe(84);
    expect(computeDockStatsColumnCount(179)).toBe(1);
    expect(computeDockStatsColumnCount(180)).toBe(2);
    expect(computeDockStatsColumnCount(275)).toBe(2);
    expect(computeDockStatsColumnCount(276)).toBe(3);
  });

  it("accepts a font-scaled minimum cell width", () => {
    expect(computeDockStatsColumnCount(139, undefined, 64)).toBe(1);
    expect(computeDockStatsColumnCount(140, undefined, 64)).toBe(2);
  });

  it("keeps at least one column for missing or invalid measurements", () => {
    expect(computeDockStatsColumnCount(0)).toBe(1);
    expect(computeDockStatsColumnCount(undefined)).toBe(1);
    expect(computeDockStatsColumnCount(200, -1)).toBe(1);
  });
});

describe("visibleDockStats", () => {
  it("keeps every selected metric regardless of column count", () => {
    const metrics = Array.from({ length: 15 }, (_, id) => id);
    expect(visibleDockStats(metrics, 2)).toEqual(metrics);
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
    expect(dockStatsGridTemplate(2)).toBe("minmax(0, 92px) minmax(12px, 1fr) minmax(0, 92px)");
  });

  it("accepts a font-scaled comfortable cell width", () => {
    expect(dockStatsGridTemplate(1, 84)).toBe("minmax(0, 84px)");
  });
});

it("uses both width and height without forcing a fixed row count", () => {
  expect(fitDockStatsColumns(300, 36, 12, 60, 18)).toBe(4);
  expect(fitDockStatsColumns(300, 108, 12, 60, 18)).toBe(2);
  expect(fitDockStatsColumns(60, 36, 12, 60, 18)).toBe(1);
});
