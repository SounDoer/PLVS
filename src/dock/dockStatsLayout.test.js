import { describe, expect, it } from "vitest";
import {
  computeDockStatsColumnCount,
  dockStatsGridPosition,
  dockStatsGridTemplate,
  DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX,
  fitDockStatsColumns,
  DOCK_STATS_MIN_CELL_WIDTH_PX,
  visibleDockStats,
  recommendedDockStatsWidth,
  dockStatsCellWidth,
} from "./dockStatsLayout.js";
import { dockMinHeight, dockStatsRowHeight, DOCK_STATS_ROW_GAP } from "./dockSizing.js";
import { UI_PREFERENCES } from "../preferences/data.js";
import { resolveInterfacePreferences } from "../preferences/interfaceSize.js";

describe("computeDockStatsColumnCount", () => {
  it("sizes a shared column from selected labels, with an aligned activity slot only when needed", () => {
    const font = { metricMeta: 13, metricValue: 18 };
    const short = dockStatsCellWidth(font, ["momentary", "shortTerm", "integrated"]);
    const long = dockStatsCellWidth(font, ["dialogueRange"]);
    const withDot = dockStatsCellWidth(font, ["dialogueRange", "dialogueCoverage"]);
    expect(short).toBeLessThan(long);
    expect(dockStatsCellWidth(font, [])).toBeGreaterThan(short);
    expect(withDot).toBeGreaterThan(long);
    expect(
      dockStatsCellWidth({ metricMeta: 17, metricValue: 24 }, ["dialogueRange", "dialogueCoverage"])
    ).toBeGreaterThan(withDot);
    expect(
      recommendedDockStatsWidth(80, 3, font, ["momentary", "shortTerm", "integrated"])
    ).toBeLessThan(
      recommendedDockStatsWidth(80, 3, font, ["dialogueRange", "dialogueCoverage", "truePeak"])
    );
  });
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

it.each(["small", "default", "large", "extra-large"])(
  "fits exactly three full Stats rows at the %s minimum without charging a trailing gap",
  (size) => {
    const font = resolveInterfacePreferences(UI_PREFERENCES, size).typography.sizesPx;
    const height = dockMinHeight(size);
    const rowHeight = dockStatsRowHeight(font);
    const width = recommendedDockStatsWidth(height, 15, font);
    const columns = fitDockStatsColumns(
      width - 12,
      height - 8,
      15,
      (DOCK_STATS_MIN_CELL_WIDTH_PX * font.metricValue) / 13,
      rowHeight + DOCK_STATS_ROW_GAP,
      DOCK_STATS_ROW_GAP
    );
    expect(columns).toBe(5);
    expect(3 * rowHeight + 2 * DOCK_STATS_ROW_GAP).toBeLessThanOrEqual(height - 8);
    // A wider viewport must still choose three rows, rather than wasting space on two.
    expect(fitDockStatsColumns(2000, height - 8, 15, 84, rowHeight + 3, 3)).toBe(5);
    expect(fitDockStatsColumns(2000, height - 9, 15, 84, rowHeight + 3, 3)).toBe(8);
  }
);
