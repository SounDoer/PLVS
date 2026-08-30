/**
 * Baseline for the unified binary protocol round (`docs/working/perf/protocol.md`).
 *
 * Every band row Rust sends today crosses the IPC boundary as JSON text: `serde_json` formats each
 * value into decimal digits and the webview parses them back into numbers, only for the frontend to
 * pack them into the Int16 slabs `FrameIntake` actually stores. This script measures both ends of
 * that trip -- bytes on the wire and milliseconds in the webview -- against the two binary shapes
 * the design doc proposes, so the round has a before number to be judged against.
 *
 * The fixture rows are deliberately all-finite. `serde_json` writes a non-finite float as `null`
 * (4 bytes), so silence is cheaper on the wire than signal; a loud row is the honest worst case.
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { buildVectorscopeSvgFromPairs } from "../src/math/vectorscopeMath.js";

/** Bands per row at the shipped 96-points-per-octave grid over 20 Hz - 20 kHz. */
export const SPECTRUM_BAND_COUNT = 958;
/** `FRAME_EMIT_MS = 16` in the capture bridge. */
export const FRAME_HZ = 62.5;
/** Visual history tick rate. */
export const VISUAL_HZ = 25;
/** The band grid is re-sent every 64 frames so a dropped frame cannot blank the session. */
export const BAND_GRID_RESEND_FRAMES = 64;

/**
 * How many 958-band rows each panel configuration puts on the wire per main frame and per visual
 * tick. Read off the payload structs in `src-tauri/src/ipc/types.rs`.
 */
export const PANEL_ROW_SHAPES = {
  // smoothDb + peakDb; the B rows serialize as empty arrays. Visual entry carries smoothDb only.
  spectrumCombined: { mainRows: 2, visualRows: 1 },
  // smoothDb + peakDb + smoothDbB + peakDbB; visual entry carries smoothDb + smoothDbB.
  spectrumLrMs: { mainRows: 4, visualRows: 2 },
  // pl + pr + c, on both the main frame and the visual entry.
  stereoMap: { mainRows: 3, visualRows: 3 },
};

let benchmarkSink;

function averageMs(callback, iterations) {
  for (let index = 0; index < 200; index += 1) benchmarkSink = callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) benchmarkSink = callback();
  return (performance.now() - started) / iterations;
}

/** A plausible loud spectrum row in dBFS, stable across runs. */
export function deterministicDbRow(bands = SPECTRUM_BAND_COUNT) {
  const row = new Float64Array(bands);
  for (let index = 0; index < bands; index += 1) {
    row[index] = -78 + Math.sin(index * 0.037) * 31 + Math.sin(index * 0.31) * 6;
  }
  return row;
}

/**
 * A plausible Stereo Map primitive row: linear energy, already f32 in Rust, spread over the wide
 * dynamic range a real spectrum has. The spread matters for the wire size -- `ryu` writes a small
 * energy in exponent form, which is several characters longer than a mid-scale one, so a row built
 * from near-uniform values would understate the JSON cost.
 */
export function deterministicEnergyRow(bands = SPECTRUM_BAND_COUNT) {
  const row = new Float32Array(bands);
  for (let index = 0; index < bands; index += 1) {
    const decades = -9 + (index / bands) * 8 + Math.sin(index * 0.037) * 1.5;
    row[index] = Math.fround(10 ** decades * (1 + Math.sin(index * 0.31) * 0.4));
  }
  return row;
}

/**
 * Shortest decimal string that round-trips through f32 -- what `serde_json` writes for a `Vec<f32>`.
 * `String(value)` would instead give the shortest string round-tripping through f64, which for a
 * value that only ever held f32 precision is much longer and would overstate Stereo Map's wire cost.
 */
export function f32ShortestString(value) {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) return "null";
  for (let digits = 1; digits <= 9; digits += 1) {
    const candidate = String(Number(rounded.toPrecision(digits)));
    if (Math.fround(Number(candidate)) === rounded) return candidate;
  }
  return String(rounded);
}

/** UTF-8 bytes of one row as `serde_json` would write it, including the brackets and commas. */
export function jsonRowBytes(row, { float32 = false } = {}) {
  const parts = new Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    parts[index] = float32 ? f32ShortestString(row[index]) : String(row[index]);
  }
  return Buffer.byteLength(`[${parts.join(",")}]`, "utf8");
}

/**
 * Bytes per second a panel configuration spends on band rows alone, at one request key.
 * @param {{ mainRows: number, visualRows: number, bytesPerRow: number }} shape
 */
export function projectedRowBandwidthBytesPerSecond({ mainRows, visualRows, bytesPerRow }) {
  return (mainRows * FRAME_HZ + visualRows * VISUAL_HZ) * bytesPerRow;
}

/** Rows per second a panel configuration decodes, at one request key. */
export function projectedRowsPerSecond({ mainRows, visualRows }) {
  return mainRows * FRAME_HZ + visualRows * VISUAL_HZ;
}

/** The periodic band-grid resend, amortized to bytes per second. */
export function projectedGridBandwidthBytesPerSecond(bytesPerRow) {
  return (bytesPerRow * FRAME_HZ) / BAND_GRID_RESEND_FRAMES;
}

function benchmarkRow(row, { float32 }) {
  const bands = row.length;
  const jsonText = `[${Array.from(row, (v) => (float32 ? f32ShortestString(v) : String(v))).join(",")}]`;
  const parsed = JSON.parse(jsonText);

  const f32Row = Float32Array.from(row);
  const f32Buffer = f32Row.buffer;

  const int16Row = new Int16Array(bands);
  for (let index = 0; index < bands; index += 1) int16Row[index] = Math.round(row[index] * 100);
  const int16Buffer = int16Row.buffer;

  return {
    bytes: {
      jsonText: Buffer.byteLength(jsonText, "utf8"),
      float32: bands * 4,
      int16: bands * 2,
    },
    msPerRow: {
      // Today's cost: parse the text, then pack what came back into the Int16 slab column.
      jsonParse: averageMs(() => JSON.parse(jsonText), 2000),
      packFromParsedArray: averageMs(() => {
        const out = new Int16Array(bands);
        for (let index = 0; index < bands; index += 1) out[index] = Math.round(parsed[index] * 100);
        return out;
      }, 5000),
      // f32 on the wire: view the received buffer, pack straight out of it.
      float32ViewAndPack: averageMs(() => {
        const src = new Float32Array(f32Buffer, 0, bands);
        const out = new Int16Array(bands);
        for (let index = 0; index < bands; index += 1) out[index] = Math.round(src[index] * 100);
        return out;
      }, 5000),
      // Int16 centi-dB on the wire: the frontend's storage form already, so only a copy remains.
      int16Copy: averageMs(() => new Int16Array(int16Buffer.slice(0)), 5000),
    },
  };
}

/** Live Lissajous points per frame: 4096 samples decimated by 6. */
export const VECTORSCOPE_LIVE_POINT_COUNT = Math.ceil(4096 / 6);

/** Deterministic Lissajous pairs, interleaved [x0, y0, x1, y1, ...]. */
export function deterministicPairs(pairCount = VECTORSCOPE_LIVE_POINT_COUNT) {
  const pairs = new Float32Array(pairCount * 2);
  for (let index = 0; index < pairCount; index += 1) {
    const angle = index * 0.071;
    pairs[index * 2] = Math.fround(Math.sin(angle) * 0.73);
    pairs[index * 2 + 1] = Math.fround(Math.sin(angle * 1.013 + 0.41) * 0.67);
  }
  return pairs;
}

/**
 * Vectorscope is the counter-example this round has to answer for, so it gets measured here rather
 * than argued about. Rust ships a finished SVG path string today; sending pairs instead saves wire
 * bytes but moves the path construction onto the webview's main thread, and that construction is
 * two orders of magnitude more expensive than parsing the string it would replace.
 */
function benchmarkVectorscopePath() {
  const pairs = deterministicPairs();
  const path = buildVectorscopeSvgFromPairs(pairs);
  const fragment = JSON.stringify({
    path,
    correlation: 0.63,
    sideToMidDb: -11.2,
    midEnergy: 0.21,
    sideEnergy: 0.08,
    pairX: 0,
    pairY: 1,
  });

  const int16 = new Int16Array(pairs.length);
  for (let index = 0; index < pairs.length; index += 1) {
    int16[index] = Math.round(pairs[index] * 32767);
  }
  const int16Buffer = int16.buffer;

  return {
    points: VECTORSCOPE_LIVE_POINT_COUNT,
    bytes: {
      jsonFragment: Buffer.byteLength(fragment, "utf8"),
      pathOnly: Buffer.byteLength(path, "utf8"),
      int16Pairs: pairs.length * 2,
      float32Pairs: pairs.length * 4,
    },
    msPerFrame: {
      // Today: the path arrives finished, so the webview only parses it.
      jsonParseFragment: averageMs(() => JSON.parse(fragment), 5000),
      // Binary: decode the pairs, then build the path the panel needs.
      int16DecodeToFloat32: averageMs(() => {
        const src = new Int16Array(int16Buffer, 0, int16.length);
        const out = new Float32Array(src.length);
        for (let index = 0; index < src.length; index += 1) out[index] = src[index] / 32767;
        return out;
      }, 5000),
      buildPathFromPairs: averageMs(() => buildVectorscopeSvgFromPairs(pairs), 2000),
    },
  };
}

/** A whole four-key combined-view frame, to size the parse the webview actually performs. */
function benchmarkWholeFrame(keyCount = 4) {
  const dbRow = deterministicDbRow();
  const energyRow = deterministicEnergyRow();
  const dbList = Array.from(dbRow);
  const energyList = Array.from(energyRow, (v) => Number(f32ShortestString(v)));

  const spectrumResultsByKey = {};
  const stereoMapResultsByKey = {};
  for (let index = 0; index < keyCount; index += 1) {
    spectrumResultsByKey[`spectrum:sm0:sp2:v0:k${index}`] = {
      smoothDb: dbList,
      peakDb: dbList,
      smoothDbB: [],
      peakDbB: [],
    };
    stereoMapResultsByKey[`stereoMap:pair:0:1:sp2:sm0:k${index}`] = {
      pl: energyList,
      pr: energyList,
      c: energyList,
    };
  }

  const frame = {
    peakDb: [-6.2, -6.8],
    rmsDb: [-18.4, -18.9],
    truePeakMaxDbtp: -5.9,
    lufsMomentary: -22.1,
    lufsShortTerm: -22.4,
    lufsMMax: -19.8,
    lufsStMax: -20.2,
    integrated: -23.1,
    lra: 7.4,
    truePeakL: -6.0,
    truePeakR: -6.3,
    sampleLDb: -6.4,
    sampleRDb: -6.7,
    correlation: 0.63,
    sideToMidDb: -11.2,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    spectrumResultsByKey,
    stereoMapResultsByKey,
    vectorscopeResultsByKey: {},
    loudnessLayout: "stereo",
    loudnessLayoutKnown: true,
    timestampMs: 1_723_000_000_000,
    bandGridId: 7,
    seq: 12_345,
    dialogueIntegrated: -24.0,
    dialoguePercent: 41.2,
    dialogueLra: 5.1,
    dialogueActiveNow: true,
  };

  const json = JSON.stringify(frame);
  return {
    keyCount,
    utf8Bytes: Buffer.byteLength(json, "utf8"),
    parseMs: averageMs(() => JSON.parse(json), 500),
  };
}

export function runBenchmark() {
  const dbRow = deterministicDbRow();
  const energyRow = deterministicEnergyRow();

  const spectrumRow = benchmarkRow(dbRow, { float32: false });
  const stereoMapRow = benchmarkRow(energyRow, { float32: true });

  const perPanel = {};
  for (const [name, shape] of Object.entries(PANEL_ROW_SHAPES)) {
    const row = name === "stereoMap" ? stereoMapRow : spectrumRow;
    const rowsPerSecond = projectedRowsPerSecond(shape);
    perPanel[name] = {
      ...shape,
      rowsPerSecond,
      bytesPerSecond: {
        jsonText: projectedRowBandwidthBytesPerSecond({
          ...shape,
          bytesPerRow: row.bytes.jsonText,
        }),
        float32: projectedRowBandwidthBytesPerSecond({ ...shape, bytesPerRow: row.bytes.float32 }),
        int16: projectedRowBandwidthBytesPerSecond({ ...shape, bytesPerRow: row.bytes.int16 }),
      },
      msPerSecond: {
        jsonText: rowsPerSecond * (row.msPerRow.jsonParse + row.msPerRow.packFromParsedArray),
        float32: rowsPerSecond * row.msPerRow.float32ViewAndPack,
        int16: rowsPerSecond * row.msPerRow.int16Copy,
      },
    };
  }

  const gridRow = jsonRowBytes(deterministicDbRow(), { float32: false });
  const result = {
    fixture: {
      bands: SPECTRUM_BAND_COUNT,
      frameHz: FRAME_HZ,
      visualHz: VISUAL_HZ,
      allValuesFinite: true,
    },
    spectrumRow,
    stereoMapRow,
    perPanel,
    bandGrid: {
      resendEveryFrames: BAND_GRID_RESEND_FRAMES,
      bytesPerSecond: {
        jsonText: projectedGridBandwidthBytesPerSecond(gridRow),
        float32: projectedGridBandwidthBytesPerSecond(SPECTRUM_BAND_COUNT * 4),
      },
    },
    vectorscopeLivePath: benchmarkVectorscopePath(),
    wholeFrame: benchmarkWholeFrame(4),
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(`FRAME_WIRE_RESULT=${JSON.stringify(result)}`);
  return result;
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();
if (isMain) runBenchmark();
