import { describe, expect, it } from "vitest";
import { deriveSurround51Pcm, SURROUND_51_CHANNEL_LABELS } from "./sharesets-preview-audio.mjs";

function stereoFrames(rows) {
  const bytes = Buffer.alloc(rows.length * 2 * 4);
  rows.flat().forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

describe("Sharesets multichannel preview audio", () => {
  it("derives the standard 5.1 channel order and deterministic gains", () => {
    const output = deriveSurround51Pcm(
      stereoFrames([
        [0.8, 0.4],
        [0.4, -0.2],
      ]),
      { sampleRateHz: 100 }
    );
    expect(SURROUND_51_CHANNEL_LABELS).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
    const samples = Array.from({ length: 12 }, (_, index) => output.readFloatLE(index * 4));
    expect(samples.slice(0, 3)).toEqual([
      0.800000011920929, 0.5360000133514404, 0.42000001668930054,
    ]);
    expect(samples[3]).toBeCloseTo(0.24, 3);
    expect(samples.slice(4, 6)).toEqual([0, 0]);
    expect(samples.slice(6, 9)).toEqual([
      0.4000000059604645, -0.2680000066757202, 0.07000000029802322,
    ]);
    expect(samples[9]).toBeCloseTo(0.04, 3);
    expect(samples.slice(10, 12)).toEqual([0, 0]);
  });

  it("rejects incomplete stereo frames", () => {
    expect(() => deriveSurround51Pcm(Buffer.alloc(7))).toThrow("interleaved stereo Float32 PCM");
  });
});
