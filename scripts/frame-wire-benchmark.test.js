import { describe, expect, it } from "vitest";
import packageInfo from "../package.json";
import {
  BAND_GRID_RESEND_FRAMES,
  deterministicDbRow,
  deterministicEnergyRow,
  deterministicPairs,
  f32ShortestString,
  FRAME_HZ,
  jsonRowBytes,
  PANEL_ROW_SHAPES,
  projectedGridBandwidthBytesPerSecond,
  projectedRowBandwidthBytesPerSecond,
  projectedRowsPerSecond,
  SPECTRUM_BAND_COUNT,
  VECTORSCOPE_LIVE_POINT_COUNT,
  VISUAL_HZ,
} from "./frame-wire-benchmark.mjs";

describe("frame wire benchmark command", () => {
  it("is reachable by a dedicated package script", () => {
    expect(packageInfo.scripts["benchmark:frame-wire"]).toBe(
      "node scripts/frame-wire-benchmark.mjs"
    );
  });
});

describe("f32ShortestString", () => {
  // The wire size of a `Vec<f32>` depends on `ryu` writing the shortest string that round-trips
  // through f32, not through f64. Modelling it with `String(value)` would inflate every Stereo Map
  // row by roughly 1.8x and make the JSON side look worse than it is.
  it("round-trips through f32 for every value it prints", () => {
    for (const value of deterministicEnergyRow()) {
      expect(Math.fround(Number(f32ShortestString(value)))).toBe(Math.fround(value));
    }
  });

  it("stays shorter than the f64 shortest form for values that only hold f32 precision", () => {
    const value = Math.fround(0.1);
    expect(f32ShortestString(value)).toBe("0.1");
    expect(String(value)).toBe("0.10000000149011612");
  });

  it("writes non-finite values as null, the way serde_json does", () => {
    expect(f32ShortestString(Number.NEGATIVE_INFINITY)).toBe("null");
    expect(f32ShortestString(Number.NaN)).toBe("null");
  });
});

describe("row fixtures", () => {
  it("builds full-width rows", () => {
    expect(deterministicDbRow()).toHaveLength(SPECTRUM_BAND_COUNT);
    expect(deterministicEnergyRow()).toHaveLength(SPECTRUM_BAND_COUNT);
  });

  it("is deterministic, so two runs are comparable", () => {
    expect(Array.from(deterministicDbRow())).toEqual(Array.from(deterministicDbRow()));
  });

  it("keeps the dB row inside a plausible display range", () => {
    for (const value of deterministicDbRow()) {
      expect(value).toBeGreaterThan(-120);
      expect(value).toBeLessThan(0);
    }
  });

  it("spreads energies over the dynamic range that makes exponent forms appear", () => {
    const printed = Array.from(deterministicEnergyRow(), f32ShortestString);
    expect(printed.some((text) => text.includes("e-"))).toBe(true);
  });

  it("counts the brackets and separators a serialized row carries", () => {
    const row = new Float64Array([0.5, 0.25, 0.125]);
    expect(jsonRowBytes(row)).toBe("[0.5,0.25,0.125]".length);
  });
});

describe("vectorscope pair fixture", () => {
  it("carries the live decimation the engine ships", () => {
    expect(VECTORSCOPE_LIVE_POINT_COUNT).toBe(Math.ceil(4096 / 6));
    expect(deterministicPairs()).toHaveLength(VECTORSCOPE_LIVE_POINT_COUNT * 2);
  });

  it("stays inside the unit square the path builder clamps to", () => {
    for (const value of deterministicPairs()) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });
});

describe("bandwidth projections", () => {
  it("counts main frames and visual ticks at their own rates", () => {
    expect(projectedRowsPerSecond({ mainRows: 2, visualRows: 1 })).toBe(2 * FRAME_HZ + VISUAL_HZ);
    expect(projectedRowsPerSecond(PANEL_ROW_SHAPES.stereoMap)).toBe(3 * FRAME_HZ + 3 * VISUAL_HZ);
  });

  it("scales linearly with the per-row size", () => {
    const shape = PANEL_ROW_SHAPES.spectrumLrMs;
    const single = projectedRowBandwidthBytesPerSecond({ ...shape, bytesPerRow: 1 });
    const double = projectedRowBandwidthBytesPerSecond({ ...shape, bytesPerRow: 2 });
    expect(single).toBe(projectedRowsPerSecond(shape));
    expect(double).toBe(single * 2);
  });

  it("amortizes the band grid resend over its period", () => {
    expect(projectedGridBandwidthBytesPerSecond(BAND_GRID_RESEND_FRAMES)).toBe(FRAME_HZ);
  });
});

describe("panel row shapes", () => {
  // These mirror the payload structs in `src-tauri/src/ipc/types.rs`. If a struct gains or loses a
  // band row, the projection is wrong until this table is updated with it.
  it("matches the rows each configuration puts on the wire", () => {
    expect(PANEL_ROW_SHAPES).toEqual({
      spectrumCombined: { mainRows: 2, visualRows: 1 },
      spectrumLrMs: { mainRows: 4, visualRows: 2 },
      stereoMap: { mainRows: 3, visualRows: 3 },
    });
  });
});
