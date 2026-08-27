import { describe, expect, it } from "vitest";
import { WaveformVisualHistorySlab } from "./WaveformVisualHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

function row(value, timestampMs = value) {
  return {
    waveformMin: [-value, -value / 2],
    waveformMax: [value, value / 2],
    dominantFrequencyHz: [100 + value, 200 + value],
    spectralCentroidHz: [300 + value, 400 + value],
    tonality: [0.25, 0.75],
    timestampMs,
  };
}

describe("WaveformVisualHistorySlab", () => {
  it("stores fixed-width waveform metrics in columnar Float32 chunks", () => {
    const slab = new WaveformVisualHistorySlab(4, 2);
    slab.push(row(1, 1000));

    expect(slab.rowAt(0)).toMatchObject({ timestampMs: 1000 });
    expect(Array.from(slab.rowAt(0).waveformMin)).toEqual([-1, -0.5]);
    expect(slab.storageStats()).toMatchObject({
      channelCount: 2,
      valueArrayType: "Float32Array",
    });
  });

  it("shares sealed chunks and copies only the active chunk on freeze", () => {
    const slab = new WaveformVisualHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 1, 2);
    for (let index = 0; index <= VISUAL_HISTORY_CHUNK_ROWS; index += 1) slab.push(row(index));
    const frozen = slab.freeze();

    expect(frozen.storageStats()).toMatchObject({
      sharedSealedChunks: 1,
      copiedTailRows: 1,
    });
    slab.push(row(99_999));
    expect(frozen.length).toBe(VISUAL_HISTORY_CHUNK_ROWS + 1);
  });
});
