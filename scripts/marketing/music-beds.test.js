import { describe, expect, it } from "vitest";
import {
  BED_51_CHANNELS,
  BED_51_PLACEMENT,
  BED_714_CHANNELS,
  BED_714_PLACEMENT,
  BED_STEREO_PLACEMENT,
  FILTERS,
  HOMEPAGE_ARRANGEMENT,
  STEREO_MASTER,
  applyArrangement,
  biquad,
  entryGain,
  filtfilt,
  limitPeaks,
  mixBed,
  parsePcm16Stereo,
  pcm24Wav,
} from "./music-beds.mjs";

const SR = 48_000;

function gainAt(sections, frequencyHz) {
  const w = (2 * Math.PI * frequencyHz) / SR;
  let magnitude = 1;
  for (const { b, a } of sections) {
    const re = (c) => c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w);
    const im = (c) => -(c[1] * Math.sin(w) + c[2] * Math.sin(2 * w));
    magnitude *= Math.hypot(re(b), im(b)) / Math.hypot(re(a), im(a));
  }
  return 20 * Math.log10(magnitude);
}

function stereoWav(frames) {
  const bytes = Buffer.alloc(44 + frames.length * 4);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + frames.length * 4, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(SR, 24);
  bytes.writeUInt32LE(SR * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(frames.length * 4, 40);
  frames.forEach(([left, right], index) => {
    bytes.writeInt16LE(left, 44 + index * 4);
    bytes.writeInt16LE(right, 46 + index * 4);
  });
  return bytes;
}

describe("Butterworth sections", () => {
  it("are -3 dB per pass at the cutoff and pass or stop DC as their type says", () => {
    expect(gainAt(FILTERS.low(SR), 120)).toBeCloseTo(-3.01, 1);
    expect(gainAt(FILTERS.high(SR), 2500)).toBeCloseTo(-3.01, 1);
    expect(gainAt(FILTERS.low(SR), 1)).toBeCloseTo(0, 3);
    expect(gainAt(FILTERS.low(SR), 1200)).toBeLessThan(-75);
    expect(gainAt(FILTERS.high(SR), 250)).toBeLessThan(-35);
    expect(
      biquad("high", 2500, Math.SQRT1_2, SR).b.reduce((sum, value) => sum + value)
    ).toBeCloseTo(0, 12);
  });

  it("filter forward and backward, so an impulse response is symmetric", () => {
    const signal = new Float64Array(4001);
    signal[2000] = 1;
    filtfilt(signal, FILTERS.low(SR));
    for (let offset = 1; offset < 400; offset += 37) {
      expect(signal[2000 - offset]).toBeCloseTo(signal[2000 + offset], 9);
    }
  });
});

describe("parsePcm16Stereo", () => {
  it("reads interleaved 16-bit frames and crops to the requested range", () => {
    const wav = stereoWav([
      [0, 0],
      [16384, -16384],
      [-32768, 32767],
    ]);
    const all = parsePcm16Stereo(wav);
    expect(Array.from(all.L)).toEqual([0, 0.5, -1]);
    const cropped = parsePcm16Stereo(wav, { startFrame: 1, frameCount: 2 });
    expect(Array.from(cropped.R)).toEqual([-0.5, 32767 / 32768].map(Math.fround));
    expect(() => parsePcm16Stereo(wav, { startFrame: 2, frameCount: 2 })).toThrow(/past the end/);
  });
});

describe("mixBed", () => {
  const ones = (value) => ({
    L: Float32Array.of(value, value),
    R: Float32Array.of(-value, -value),
  });

  it("sums the placed sides with their gains and normalises one gain to the peak", () => {
    const { samples, gain } = mixBed(
      { A: ones(0.5), B: ones(0.25) },
      {
        placement: {
          X: [
            ["A", "L", 1],
            ["B", "R", 2],
          ],
          Y: [["A", "mono", 1]],
        },
        channels: ["X", "Y"],
        sampleRateHz: SR,
        peakDbfs: 0,
      }
    );
    // X = 0.5 - 0.5 = 0, Y = mono(A) = 0; a silent mix keeps unity gain.
    expect(gain).toBe(1);
    expect(Array.from(samples)).toEqual([0, 0, 0, 0]);

    const loud = mixBed(
      { A: ones(0.5) },
      {
        placement: { X: [["A", "L", 1]], Y: [["A", "R", 0.5]] },
        channels: ["X", "Y"],
        sampleRateHz: SR,
        peakDbfs: -6,
      }
    );
    expect(loud.samples[0]).toBeCloseTo(10 ** (-6 / 20), 6);
    expect(loud.samples[1]).toBeCloseTo(-(10 ** (-6 / 20)) / 2, 6);
  });

  it("refuses a placement that names a missing stem", () => {
    expect(() =>
      mixBed(
        { A: ones(1) },
        { placement: { X: [["B", "L", 1]] }, channels: ["X"], sampleRateHz: SR }
      )
    ).toThrow(/missing stem: B/);
  });

  it("places all ten musical stems across the twelve 7.1.4 channels", () => {
    expect(Object.keys(BED_714_PLACEMENT).sort()).toEqual([...BED_714_CHANNELS].sort());
    const used = new Set(
      Object.values(BED_714_PLACEMENT).flatMap((terms) => terms.map(([stem]) => stem))
    );
    expect([...used].sort()).toEqual([
      "Bass",
      "Brass",
      "Drums",
      "Guitar",
      "Keyboard",
      "Other",
      "Percussion",
      "Strings",
      "Synth",
      "Woodwinds",
    ]);
  });

  it("folds the 7.1.4 placement into 5.1 without losing a stem", () => {
    // Front heights fold into L/R, backs and rear heights into Ls/Rs; a stem keeps its largest
    // gain; a filtered term is dropped where the channel already carries that stem unfiltered.
    const fold = { Ltf: "L", Rtf: "R", Lb: "Ls", Rb: "Rs", Ltr: "Ls", Rtr: "Rs" };
    const expected = {};
    for (const [channel, terms] of Object.entries(BED_714_PLACEMENT)) {
      const target = (expected[fold[channel] ?? channel] ??= new Map());
      for (const [stem, side, gain, filter] of terms) {
        const key = `${stem}|${side}|${filter ?? ""}`;
        target.set(key, Math.max(target.get(key) ?? 0, gain));
      }
    }
    for (const [channel, terms] of Object.entries(expected)) {
      if (channel === "LFE") continue;
      for (const key of [...terms.keys()]) {
        const [stem, side, filter] = key.split("|");
        if (filter && terms.has(`${stem}|${side}|`)) terms.delete(key);
      }
    }
    const asSorted = (placement) =>
      Object.fromEntries(
        Object.entries(placement).map(([channel, terms]) => [
          channel,
          [...terms].map(([key, gain]) => `${key}|${gain}`).sort(),
        ])
      );
    const actual = Object.fromEntries(
      Object.entries(BED_51_PLACEMENT).map(([channel, terms]) => [
        channel,
        new Map(
          terms.map(([stem, side, gain, filter]) => [`${stem}|${side}|${filter ?? ""}`, gain])
        ),
      ])
    );
    expect(Object.keys(BED_51_PLACEMENT).sort()).toEqual([...BED_51_CHANNELS].sort());
    expect(asSorted(actual)).toEqual(asSorted(expected));
  });
});

describe("arrangement", () => {
  it("fades each stem in from silence at its entry", () => {
    expect(entryGain(0, 0, 2000)).toBe(1);
    expect(entryGain(29_999, 30_000, 2000)).toBe(0);
    expect(entryGain(31_000, 30_000, 2000)).toBe(0.5);
    expect(entryGain(32_000, 30_000, 2000)).toBe(1);
  });

  it("scales stems in place and refuses a stem without an entry", () => {
    const stems = {
      Keys: { L: Float32Array.of(1, 1, 1, 1), R: Float32Array.of(1, 1, 1, 1) },
      Drums: { L: Float32Array.of(1, 1, 1, 1), R: Float32Array.of(-1, -1, -1, -1) },
    };
    applyArrangement(stems, { entryMs: { Keys: 0, Drums: 1000 }, rampMs: 2000 }, 1);
    expect(Array.from(stems.Keys.L)).toEqual([1, 1, 1, 1]);
    expect(Array.from(stems.Drums.L)).toEqual([0, 0, 0.5, 1]);
    expect(Array.from(stems.Drums.R)).toEqual([-0, -0, -0.5, -1]);
    expect(() => applyArrangement({ Bass: stems.Keys }, { entryMs: {}, rampMs: 1 }, 1)).toThrow(
      /no entry for Bass/
    );
  });

  it("covers every placed stem, and the stereo sum uses each once per side", () => {
    const arranged = Object.keys(HOMEPAGE_ARRANGEMENT.entryMs).sort();
    const placed = new Set(
      Object.values(BED_714_PLACEMENT).flatMap((terms) => terms.map(([stem]) => stem))
    );
    expect(arranged).toEqual([...placed].sort());
    expect(BED_STEREO_PLACEMENT.L.map(([stem]) => stem).sort()).toEqual(arranged);
    expect(BED_STEREO_PLACEMENT.R.every(([, side, gain]) => side === "R" && gain === 1)).toBe(true);
  });
});

describe("limitPeaks", () => {
  const master = { makeupGainDb: 6, ceilingDbfs: -1, lookaheadMs: 1, releaseMs: 10 };

  it("keeps every sample under the ceiling after make-up gain", () => {
    const samples = new Float32Array(2 * 4800);
    for (let frame = 0; frame < 4800; frame += 1) {
      const body = 0.2 * Math.sin(frame / 7);
      const hit = frame % 960 === 100 ? 0.9 : 0;
      samples[frame * 2] = body + hit;
      samples[frame * 2 + 1] = -body;
    }
    limitPeaks(samples, 2, 48_000, master);
    const ceiling = 10 ** (-1 / 20);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6);
  });

  it("applies only the make-up gain where nothing would exceed the ceiling", () => {
    const samples = Float32Array.from({ length: 200 }, (_, index) => 0.1 * Math.sin(index));
    const expected = samples.map((value) => value * 10 ** (6 / 20));
    limitPeaks(samples, 1, 48_000, master);
    samples.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
  });

  it("has the documented master settings", () => {
    expect(STEREO_MASTER).toMatchObject({ ceilingDbfs: -1 });
  });
});

describe("pcm24Wav", () => {
  it("writes 24-bit little-endian samples and refuses values outside [-1, 1]", () => {
    const wav = pcm24Wav(Float32Array.of(0, 1, -1, 0.5), 2, 48_000);
    expect(wav.readUInt16LE(34)).toBe(24);
    expect(wav.readUInt32LE(40)).toBe(12);
    expect([0, 1, 2, 3].map((index) => wav.readIntLE(44 + index * 3, 3))).toEqual([
      0, 8388607, -8388607, 4194304,
    ]);
    expect(() => pcm24Wav(Float32Array.of(1.5), 1, 48_000)).toThrow(/outside/);
  });
});
