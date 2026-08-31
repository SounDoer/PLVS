import { describe, expect, it } from "vitest";

import {
  compareSilhouettes,
  parseArgs,
  silhouetteColumns,
  summarise,
} from "./spectrogram-shimmer-probe.mjs";

/**
 * Builds an RGBA buffer from a per-column list of alphas, given top-down.
 * `columns[x][row]` is the alpha at screen row `row`.
 */
function frame(columns, { flipped = false } = {}) {
  const width = columns.length;
  const height = columns[0].length;
  const px = new Uint8Array(width * height * 4);
  for (let x = 0; x < width; x++) {
    for (let row = 0; row < height; row++) {
      const y = flipped ? height - 1 - row : row;
      px[(y * width + x) * 4 + 3] = columns[x][row];
    }
  }
  return { px, width, height };
}

describe("silhouetteColumns", () => {
  it("puts a hard edge on the integer row it lands on", () => {
    // Nothing, nothing, then fully opaque terrain: both definitions must agree on row 2.
    const { px, width, height } = frame([[0, 0, 255, 255]]);
    const { top, ink } = silhouetteColumns(px, width, height, false);
    expect(top[0]).toBe(2);
    expect(ink[0]).toBe(2);
  });

  it("places a soft edge between rows, which is the whole point of the ink measure", () => {
    // Half a pixel of coverage on row 1, then solid. One pixel of opacity is reached partway into
    // row 2, so the edge sits above it -- a hard-threshold reading would have said 1 or 2 and
    // nothing in between.
    const { px, width, height } = frame([[0, 128, 255, 255]]);
    const { top, ink } = silhouetteColumns(px, width, height, false);
    expect(top[0]).toBe(1);
    expect(ink[0]).toBeCloseTo(2 - 128 / 255, 10);
    expect(ink[0]).toBeGreaterThan(1);
    expect(ink[0]).toBeLessThan(2);
  });

  it("moves the soft edge continuously as coverage grows", () => {
    // The same edge gaining coverage must move the reading smoothly, not in steps. This is what the
    // legacy `alpha > 8` definition cannot see, and why it scored the antialiased renderer worse.
    const readings = [40, 80, 120, 160].map((a) => {
      const { px, width, height } = frame([[0, a, 255, 255]]);
      return silhouetteColumns(px, width, height, false).ink[0];
    });
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeLessThan(readings[i - 1]);
    }
    // …and every step is a fraction of a pixel, never a whole one.
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i - 1] - readings[i]).toBeLessThan(1);
    }
  });

  it("reads a bottom-up buffer into screen rows", () => {
    // readPixels returns rows bottom-up; the answer must not depend on that.
    const columns = [[0, 0, 255, 255]];
    const upright = frame(columns);
    const upside = frame(columns, { flipped: true });
    expect(silhouetteColumns(upright.px, 1, 4, false).ink[0]).toBe(
      silhouetteColumns(upside.px, 1, 4, true).ink[0]
    );
  });

  it("marks an empty column as having no silhouette rather than as row zero", () => {
    const { px, width, height } = frame([[0, 0, 0, 0]]);
    const { top, ink } = silhouetteColumns(px, width, height, false);
    expect(top[0]).toBe(-1);
    expect(Number.isNaN(ink[0])).toBe(true);
  });

  it("reports coverage over the whole buffer", () => {
    const { px, width, height } = frame([
      [0, 0, 255, 255],
      [0, 0, 0, 0],
    ]);
    expect(silhouetteColumns(px, width, height, false).coverage).toBe(25);
  });
});

describe("compareSilhouettes", () => {
  it("counts a column as popped only once it moves a whole pixel", () => {
    const previous = Float64Array.from([10, 10, 10]);
    const current = Float64Array.from([10.4, 11, 12.5]);
    const r = compareSilhouettes(previous, current);
    expect(r.columns).toBe(3);
    expect(r.popped).toBe(2);
    expect(r.deformSum).toBeCloseTo(0.4 + 1 + 2.5, 10);
  });

  it("skips columns with no terrain in either frame", () => {
    // A column the terrain has not reached says nothing about how steady the terrain is, and
    // counting it as an unmoved column would dilute the rate -- the same dilution the floor grid
    // causes, which is why the probe is run with the grid off.
    const previous = Float64Array.from([10, NaN, 10]);
    const current = Float64Array.from([12, 10, NaN]);
    const r = compareSilhouettes(previous, current);
    expect(r.columns).toBe(1);
    expect(r.popped).toBe(1);
  });

  it("treats the legacy -1 sentinel as absent too", () => {
    const r = compareSilhouettes(Int32Array.from([-1, 5]), Int32Array.from([4, -1]));
    expect(r.columns).toBe(0);
  });
});

describe("summarise", () => {
  it("reports the ink measure as the headline and keeps the legacy one beside it", () => {
    const row = summarise(
      {
        source: "webgl",
        error: null,
        frames: 100,
        changed: 20,
        updates: 19,
        coverageFirst: 36,
        coverageLast: 36.2,
        ink: { columns: 200, popped: 70, deformSum: 150 },
        top: { columns: 200, popped: 110, deformSum: 160 },
      },
      "arm B"
    );
    expect(row.poppingPct).toBeCloseTo(35, 10);
    expect(row.legacyPoppingPct).toBeCloseTo(55, 10);
    expect(row.deformPx).toBeCloseTo(0.75, 10);
  });

  it("reports null rather than zero when nothing was comparable", () => {
    const row = summarise(
      {
        source: "2d",
        error: null,
        frames: 1,
        changed: 0,
        updates: 0,
        coverageFirst: null,
        coverageLast: null,
        ink: { columns: 0, popped: 0, deformSum: 0 },
        top: { columns: 0, popped: 0, deformSum: 0 },
      },
      ""
    );
    expect(row.poppingPct).toBeNull();
    expect(row.deformPx).toBeNull();
  });
});

describe("parseArgs", () => {
  it("defaults to the port the perf scripts document", () => {
    expect(parseArgs([]).port).toBe(9222);
  });

  it("rejects a duration that would sample nothing", () => {
    expect(() => parseArgs(["--seconds", "0"])).toThrow(/--seconds/);
  });
});
