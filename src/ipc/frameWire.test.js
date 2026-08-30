import { describe, expect, it } from "vitest";
import { decodeFrameWire, FRAME_WIRE_VERSION } from "./frameWire.js";

/**
 * Lays out a message the way `src-tauri/src/ipc/wire.rs` does, so the cases below can vary one
 * thing at a time. The golden test at the bottom is what actually pins the two sides together;
 * this helper only has to agree with the format, not prove it.
 */
function encode(envelope, sections) {
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  const alignUp = (offset, alignment) =>
    offset % alignment === 0 ? offset : offset + (alignment - (offset % alignment));

  let total = alignUp(4 + json.length, 8);
  for (const section of sections) {
    total = alignUp(total, section.BYTES_PER_ELEMENT) + section.byteLength;
  }

  const buffer = new ArrayBuffer(total);
  new DataView(buffer).setUint32(0, json.length, true);
  new Uint8Array(buffer).set(json, 4);

  let offset = alignUp(4 + json.length, 8);
  for (const section of sections) {
    offset = alignUp(offset, section.BYTES_PER_ELEMENT);
    new Uint8Array(buffer).set(
      new Uint8Array(section.buffer, section.byteOffset, section.byteLength),
      offset
    );
    offset += section.byteLength;
  }
  return buffer;
}

const binRef = (bin, dtype, len) => ({ $bin: bin, dtype, len });

describe("decodeFrameWire", () => {
  it("swaps every descriptor for a view over the section it names", () => {
    // Powers of two: a fixture written with round decimals would assert float representation
    // rather than layout (see AGENTS.md).
    const smooth = Float32Array.from([0.25, -0.5, 0.875]);
    const buffer = encode(
      {
        wireVersion: FRAME_WIRE_VERSION,
        spectrumResultsByKey: { "spectrum:k": { smoothDb: binRef(0, "f32", 3) } },
      },
      [smooth]
    );

    const frame = decodeFrameWire(buffer);
    const row = frame.spectrumResultsByKey["spectrum:k"].smoothDb;

    expect(row).toBeInstanceOf(Float32Array);
    expect(Array.from(row)).toEqual([0.25, -0.5, 0.875]);
  });

  it("leaves the scalar half of the envelope exactly as it arrived", () => {
    const buffer = encode(
      { wireVersion: FRAME_WIRE_VERSION, seq: 41, correlation: 0.5, loudnessLayout: "stereo" },
      []
    );

    expect(decodeFrameWire(buffer)).toEqual({
      wireVersion: FRAME_WIRE_VERSION,
      seq: 41,
      correlation: 0.5,
      loudnessLayout: "stereo",
    });
  });

  it("reads sections in $bin order, not in the order the envelope mentions them", () => {
    // JSON object key order is not something either side should have to preserve, so the decoder
    // has to place sections by their index alone.
    const first = Float32Array.from([0.5]);
    const second = Int16Array.from([7, -7]);
    const buffer = encode(
      {
        wireVersion: FRAME_WIRE_VERSION,
        later: binRef(1, "i16", 2),
        earlier: binRef(0, "f32", 1),
      },
      [first, second]
    );

    const frame = decodeFrameWire(buffer);

    expect(Array.from(frame.earlier)).toEqual([0.5]);
    expect(Array.from(frame.later)).toEqual([7, -7]);
  });

  it("finds descriptors nested inside arrays, the way a file-mode batch carries them", () => {
    const buffer = encode(
      {
        wireVersion: FRAME_WIRE_VERSION,
        visualHistBatch: [{ spectrumByKey: { k: { smoothDb: binRef(0, "f32", 2) } } }],
      },
      [Float32Array.from([0.25, 0.5])]
    );

    const frame = decodeFrameWire(buffer);

    expect(Array.from(frame.visualHistBatch[0].spectrumByKey.k.smoothDb)).toEqual([0.25, 0.5]);
  });

  it("keeps a wide row aligned when an odd-length narrow one precedes it", () => {
    const narrow = Int16Array.from([1, 2, 3]);
    const wide = Float64Array.from([1.5, 2.5]);
    const buffer = encode(
      { wireVersion: FRAME_WIRE_VERSION, a: binRef(0, "i16", 3), b: binRef(1, "f64", 2) },
      [narrow, wide]
    );

    const frame = decodeFrameWire(buffer);

    expect(Array.from(frame.a)).toEqual([1, 2, 3]);
    expect(Array.from(frame.b)).toEqual([1.5, 2.5]);
  });

  it("rejects a version it was not built to read", () => {
    const buffer = encode({ wireVersion: FRAME_WIRE_VERSION + 1 }, []);

    expect(() => decodeFrameWire(buffer)).toThrow(/version/);
  });

  it("rejects an unknown dtype rather than guessing a width", () => {
    const buffer = encode({ wireVersion: FRAME_WIRE_VERSION, row: binRef(0, "f16", 2) }, []);

    expect(() => decodeFrameWire(buffer)).toThrow(/dtype/);
  });

  it("rejects a section that runs past the end of the message", () => {
    const buffer = encode({ wireVersion: FRAME_WIRE_VERSION, row: binRef(0, "f32", 8) }, [
      Float32Array.from([0.5]),
    ]);

    expect(() => decodeFrameWire(buffer)).toThrow(/past the end/);
  });

  it("rejects a truncated message instead of reading whatever follows", () => {
    expect(() => decodeFrameWire(new ArrayBuffer(2))).toThrow(/too short/);

    const short = new ArrayBuffer(8);
    new DataView(short).setUint32(0, 999, true);
    expect(() => decodeFrameWire(short)).toThrow(/claims 999 bytes/);
  });
});

describe("the Rust encoder's golden message", () => {
  // These bytes are produced by `ipc::wire::tests::golden_message_matches_the_bytes_the_frontend_
  // test_decodes` in `src-tauri/src/ipc/wire.rs`. The two sides share no code, so this fixture is
  // the only thing keeping them from drifting apart; change it in both places or not at all.
  const GOLDEN = Uint8Array.from([
    142, 0, 0, 0, 123, 34, 115, 101, 113, 34, 58, 55, 44, 34, 115, 112, 101, 99, 116, 114, 117, 109,
    82, 101, 115, 117, 108, 116, 115, 66, 121, 75, 101, 121, 34, 58, 123, 34, 107, 34, 58, 123, 34,
    112, 101, 97, 107, 68, 98, 34, 58, 123, 34, 36, 98, 105, 110, 34, 58, 49, 44, 34, 100, 116, 121,
    112, 101, 34, 58, 34, 105, 49, 54, 34, 44, 34, 108, 101, 110, 34, 58, 50, 125, 44, 34, 115, 109,
    111, 111, 116, 104, 68, 98, 34, 58, 123, 34, 36, 98, 105, 110, 34, 58, 48, 44, 34, 100, 116,
    121, 112, 101, 34, 58, 34, 102, 51, 50, 34, 44, 34, 108, 101, 110, 34, 58, 51, 125, 125, 125,
    44, 34, 119, 105, 114, 101, 86, 101, 114, 115, 105, 111, 110, 34, 58, 49, 125, 0, 0, 0, 0, 0, 0,
    0, 0, 128, 62, 0, 0, 0, 191, 0, 0, 96, 63, 255, 255, 2, 0,
  ]);

  it("decodes to the frame Rust described", () => {
    const frame = decodeFrameWire(GOLDEN.buffer);
    const result = frame.spectrumResultsByKey.k;

    expect(frame.seq).toBe(7);
    expect(frame.wireVersion).toBe(FRAME_WIRE_VERSION);
    expect(result.smoothDb).toBeInstanceOf(Float32Array);
    expect(Array.from(result.smoothDb)).toEqual([0.25, -0.5, 0.875]);
    expect(result.peakDb).toBeInstanceOf(Int16Array);
    expect(Array.from(result.peakDb)).toEqual([-1, 2]);
  });
});
