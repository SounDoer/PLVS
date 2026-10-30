// Multichannel beds mixed from the "Full Band Crescendo" Suno stems. The placement follows the
// promo film's make_mc.py so each channel carries different instruments rather than an upmix.
// Unlike make_mc.py, Synth also feeds the backs: percussion and Other are sparse in this song.
// Keyboard and Strings, the only stems playing from the start, also feed C, the sides, the backs
// and the rear heights, so no channel but LFE is silent before the later groups enter.
// The FFmpeg sidecar has no filters, so mixing and the Butterworth filters are done here.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "./homepage-audio.mjs";

export const BED_714_CHANNELS = Object.freeze([
  "L",
  "R",
  "C",
  "LFE",
  "Lb",
  "Rb",
  "Ls",
  "Rs",
  "Ltf",
  "Rtf",
  "Ltr",
  "Rtr",
]);

// Each channel is a sum of terms: [stem, side, gain, filter]. side is "L", "R" or "mono";
// filter is "low" (4th-order 120 Hz low-pass), "high" (2nd-order 2.5 kHz high-pass) or absent.
// A filter applies to the whole sum of its channel's terms that name it.
export const BED_714_PLACEMENT = Object.freeze({
  L: [
    ["Drums", "L", 1],
    ["Keyboard", "L", 0.5],
    ["Bass", "L", 0.4],
  ],
  R: [
    ["Drums", "R", 1],
    ["Keyboard", "R", 0.5],
    ["Bass", "R", 0.4],
  ],
  C: [
    ["Bass", "mono", 0.8],
    ["Brass", "mono", 0.5],
    ["Keyboard", "mono", 0.5],
  ],
  LFE: [
    ["Bass", "mono", 1, "low"],
    ["Drums", "mono", 0.7, "low"],
  ],
  Lb: [
    ["Percussion", "L", 1],
    ["Other", "L", 0.7],
    ["Synth", "L", 0.5],
    ["Strings", "L", 0.5],
  ],
  Rb: [
    ["Percussion", "R", 1],
    ["Other", "R", 0.7],
    ["Synth", "R", 0.5],
    ["Strings", "R", 0.5],
  ],
  Ls: [
    ["Guitar", "L", 1],
    ["Synth", "L", 0.7],
    ["Strings", "L", 0.6],
  ],
  Rs: [
    ["Guitar", "R", 1],
    ["Synth", "R", 0.7],
    ["Strings", "R", 0.6],
  ],
  Ltf: [
    ["Brass", "L", 0.8],
    ["Strings", "L", 0.7],
    ["Keyboard", "L", 1, "high"],
  ],
  Rtf: [
    ["Brass", "R", 0.8],
    ["Strings", "R", 0.7],
    ["Keyboard", "R", 1, "high"],
  ],
  Ltr: [
    ["Synth", "L", 0.6],
    ["Woodwinds", "L", 1],
    ["Percussion", "L", 1, "high"],
    ["Keyboard", "L", 0.6, "high"],
  ],
  Rtr: [
    ["Synth", "R", 0.6],
    ["Woodwinds", "R", 1],
    ["Percussion", "R", 1, "high"],
    ["Keyboard", "R", 0.6, "high"],
  ],
});

export const BED_51_CHANNELS = Object.freeze(["L", "R", "C", "LFE", "Ls", "Rs"]);

// The 7.1.4 placement folded to 5.1: front heights into L/R, backs and rear heights into Ls/Rs.
// A stem folded from several channels keeps its largest gain, and a high-passed term is dropped
// where its channel already carries the same stem full-band. Unlike make_mc.py the heights are
// not dropped, which would lose Strings and Woodwinds.
export const BED_51_PLACEMENT = Object.freeze({
  L: [
    ["Drums", "L", 1],
    ["Keyboard", "L", 0.5],
    ["Bass", "L", 0.4],
    ["Brass", "L", 0.8],
    ["Strings", "L", 0.7],
  ],
  R: [
    ["Drums", "R", 1],
    ["Keyboard", "R", 0.5],
    ["Bass", "R", 0.4],
    ["Brass", "R", 0.8],
    ["Strings", "R", 0.7],
  ],
  C: BED_714_PLACEMENT.C,
  LFE: BED_714_PLACEMENT.LFE,
  Ls: [
    ["Guitar", "L", 1],
    ["Synth", "L", 0.7],
    ["Strings", "L", 0.6],
    ["Percussion", "L", 1],
    ["Other", "L", 0.7],
    ["Woodwinds", "L", 1],
    ["Keyboard", "L", 0.6, "high"],
  ],
  Rs: [
    ["Guitar", "R", 1],
    ["Synth", "R", 0.7],
    ["Strings", "R", 0.6],
    ["Percussion", "R", 1],
    ["Other", "R", 0.7],
    ["Woodwinds", "R", 1],
    ["Keyboard", "R", 0.6, "high"],
  ],
});

export const BED_PEAK_DBFS = -1;

// The homepage beds are an arrangement of the stems, not the song's master: the source span is
// song time 113-188 s, and instruments enter one group at a time so the 60 s window after the
// 15 s pre-roll builds from keys and strings to the full band. Times are bed time.
export const HOMEPAGE_ARRANGEMENT = Object.freeze({
  songStartMs: 113_000,
  durationMs: 75_000,
  rampMs: 2_000,
  entryMs: Object.freeze({
    Keyboard: 0,
    Strings: 0,
    Synth: 30_000,
    Percussion: 30_000,
    Guitar: 30_000,
    Bass: 45_000,
    Drums: 45_000,
    Brass: 60_000,
    Woodwinds: 60_000,
    Other: 60_000,
  }),
});

export const BED_STEREO_CHANNELS = Object.freeze(["L", "R"]);

// Pan positions (-1 left, +1 right) for the narrower stems, so Stereo Map Position shows their
// bands off centre; the stems not listed stay where Suno placed them.
export const STEREO_PAN = Object.freeze({
  Guitar: -0.7,
  Brass: -0.4,
  Percussion: 0.7,
  Woodwinds: 0.5,
  Other: 0.5,
});

/** Constant-power side gains for pan position `pan`, unity at centre. */
export function panGains(pan) {
  const angle = ((pan + 1) * Math.PI) / 4;
  return { L: Math.SQRT2 * Math.cos(angle), R: Math.SQRT2 * Math.sin(angle) };
}

/** Every arranged stem on its own side, panned by `STEREO_PAN`: the stereo sum of the arrangement. */
export const BED_STEREO_PLACEMENT = Object.freeze(
  Object.fromEntries(
    BED_STEREO_CHANNELS.map((side) => [
      side,
      Object.keys(HOMEPAGE_ARRANGEMENT.entryMs).map((stem) => [
        stem,
        side,
        panGains(STEREO_PAN[stem] ?? 0)[side],
      ]),
    ])
  )
);

/** Gain of a stem entering at `entryMs`: silent before, a linear fade over `rampMs`, then 1. */
export function entryGain(timeMs, entryMs, rampMs) {
  if (entryMs <= 0 || timeMs >= entryMs + rampMs) return 1;
  if (timeMs <= entryMs) return 0;
  return (timeMs - entryMs) / rampMs;
}

/** Apply each stem's entry fade in place; every stem must have an entry. */
export function applyArrangement(stems, { entryMs, rampMs }, sampleRateHz) {
  for (const [name, stem] of Object.entries(stems)) {
    const entry = entryMs[name];
    if (entry === undefined) throw new Error(`The arrangement has no entry for ${name}.`);
    if (entry <= 0) continue;
    for (let frame = 0; frame < stem.L.length; frame += 1) {
      const gain = entryGain((frame * 1000) / sampleRateHz, entry, rampMs);
      if (gain === 1) break;
      stem.L[frame] *= gain;
      stem.R[frame] *= gain;
    }
  }
  return stems;
}

// The stereo bed is mastered like a release: the stem sum has drum transients well above its
// body, so a make-up gain and a peak limiter bring Short-term up to the hero's warning without
// pushing True Peak past 0 dBTP. Drums and Bass are nearly mono and dominate the sum, so a side
// gain widens the image (the wide stems spread further) before the limiter.
export const STEREO_MASTER = Object.freeze({
  sideGain: 1.5,
  makeupGainDb: 3,
  ceilingDbfs: -1,
  lookaheadMs: 5,
  releaseMs: 80,
});

/** Mid/side widening in place on interleaved stereo: the side signal is scaled by `sideGain`. */
export function widenStereo(samples, sideGain) {
  for (let index = 0; index < samples.length; index += 2) {
    const mid = (samples[index] + samples[index + 1]) / 2;
    const side = ((samples[index] - samples[index + 1]) / 2) * sideGain;
    samples[index] = mid + side;
    samples[index + 1] = mid - side;
  }
  return samples;
}

/**
 * Linked lookahead peak limiter, in place on interleaved samples. Gain reduction reaches the
 * required depth before each over (running minimum over the lookahead, then a moving average of
 * the same length, which never exceeds the required gain at the peak) and releases exponentially.
 */
export function limitPeaks(samples, channels, sampleRateHz, master) {
  const frames = samples.length / channels;
  const ceiling = 10 ** (master.ceilingDbfs / 20);
  const makeup = 10 ** (master.makeupGainDb / 20);
  const lookahead = Math.max(1, Math.round((master.lookaheadMs * sampleRateHz) / 1000));
  const release = 1 - Math.exp(-1 / ((master.releaseMs * sampleRateHz) / 1000));
  const required = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      peak = Math.max(peak, Math.abs(samples[frame * channels + channel] * makeup));
    }
    required[frame] = peak > ceiling ? ceiling / peak : 1;
  }
  // Running minimum of required[n .. n + lookahead] (monotonic deque of indices).
  const ahead = new Float64Array(frames);
  const deque = new Int32Array(frames);
  let head = 0;
  let tail = 0;
  for (let index = frames - 1; index >= 0; index -= 1) {
    while (tail > head && required[deque[tail - 1]] >= required[index]) tail -= 1;
    deque[tail] = index;
    tail += 1;
    while (deque[head] > index + lookahead) head += 1;
    ahead[index] = required[deque[head]];
  }
  let sum = 0;
  let gain = 1;
  for (let frame = 0; frame < frames; frame += 1) {
    // Moving average of ahead[frame - lookahead .. frame], counting frames before the start as 1.
    sum += ahead[frame];
    if (frame > lookahead) sum -= ahead[frame - lookahead - 1];
    const smoothed = (sum + Math.max(0, lookahead - frame)) / (lookahead + 1);
    gain = Math.min(smoothed, ahead[frame], gain + (1 - gain) * release);
    for (let channel = 0; channel < channels; channel += 1) {
      samples[frame * channels + channel] *= makeup * gain;
    }
  }
  return samples;
}

/** Interleaved float samples as a 24-bit PCM WAV; samples must lie in [-1, 1]. */
export function pcm24Wav(samples, channels, sampleRateHz) {
  const dataBytes = samples.length * 3;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRateHz, 24);
  bytes.writeUInt32LE(sampleRateHz * channels * 3, 28);
  bytes.writeUInt16LE(channels * 3, 32);
  bytes.writeUInt16LE(24, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    if (!(Math.abs(value) <= 1)) throw new Error("A 24-bit sample lies outside [-1, 1].");
    bytes.writeIntLE(Math.max(-8388608, Math.round(value * 8388607)), 44 + index * 3, 3);
  }
  return bytes;
}

/** The arranged stems over the homepage span, verified against their pinned hashes. */
export async function readArrangedStems(stemsDir, source, arrangement = HOMEPAGE_ARRANGEMENT) {
  const msToFrames = (ms, rate) => Math.round((ms * rate) / 1000);
  const rate = source.song.sampleRateHz;
  const { stems, sampleRateHz } = await readVerifiedStems(stemsDir, source, {
    startFrame: msToFrames(arrangement.songStartMs, rate),
    frameCount: msToFrames(arrangement.durationMs, rate),
  });
  return { stems: applyArrangement(stems, arrangement, sampleRateHz), sampleRateHz };
}

/** RBJ biquad coefficients, normalised so a0 = 1. */
export function biquad(type, frequencyHz, q, sampleRateHz) {
  const w = (2 * Math.PI * frequencyHz) / sampleRateHz;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b =
    type === "low"
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return { b: b.map((value) => value / a0), a: [1, (-2 * cos) / a0, (1 - alpha) / a0] };
}

// Butterworth sections: the 4th-order low-pass is two biquads at Q 0.5412 and 1.3066.
export const FILTERS = Object.freeze({
  low: (sampleRateHz) => [
    biquad("low", 120, 1 / (2 * Math.cos(Math.PI / 8)), sampleRateHz),
    biquad("low", 120, 1 / (2 * Math.cos((3 * Math.PI) / 8)), sampleRateHz),
  ],
  high: (sampleRateHz) => [biquad("high", 2500, Math.SQRT1_2, sampleRateHz)],
});

function runSection(signal, { b, a }, reverse) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const length = signal.length;
  for (let step = 0; step < length; step += 1) {
    const index = reverse ? length - 1 - step : step;
    const x = signal[index];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    signal[index] = y;
  }
}

/** Zero-phase filtering in place: every section forward, then every section backward. */
export function filtfilt(signal, sections) {
  for (const section of sections) runSection(signal, section, false);
  for (const section of sections) runSection(signal, section, true);
  return signal;
}

/**
 * Parse a 16-bit PCM stereo WAV into per-side Float32 arrays scaled to [-1, 1), keeping only
 * `frameCount` frames from `startFrame` (all frames by default).
 */
export function parsePcm16Stereo(bytes, { startFrame = 0, frameCount = Infinity } = {}) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Stem is not a RIFF/WAVE file.");
  }
  let offset = 12;
  let format = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        tag: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        sampleRateHz: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!format || format.tag !== 1 || format.channels !== 2 || format.bits !== 16) {
        throw new Error("Stems must be 16-bit PCM stereo WAV.");
      }
      const available = Math.floor(Math.min(size, bytes.length - body) / 4);
      if (startFrame + (Number.isFinite(frameCount) ? frameCount : 0) > available) {
        throw new Error("Requested stem range runs past the end of the stem.");
      }
      const frames = Number.isFinite(frameCount) ? frameCount : available - startFrame;
      const L = new Float32Array(frames);
      const R = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        const at = body + (startFrame + frame) * 4;
        L[frame] = bytes.readInt16LE(at) / 32768;
        R[frame] = bytes.readInt16LE(at + 2) / 32768;
      }
      return { sampleRateHz: format.sampleRateHz, L, R };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("Stem has no data chunk.");
}

function stemSide(stem, side) {
  if (side === "L") return stem.L;
  if (side === "R") return stem.R;
  const mono = new Float32Array(stem.L.length);
  for (let index = 0; index < mono.length; index += 1) {
    mono[index] = (stem.L[index] + stem.R[index]) / 2;
  }
  return mono;
}

/**
 * Mix stems into an interleaved Float32 bed. `stems` maps a stem name to `{ L, R }` sample
 * arrays of equal length; the buses are summed and filtered in Float64. One gain scales every channel so the sample peak is `peakDbfs`.
 */
export function mixBed(stems, { placement, channels, sampleRateHz, peakDbfs = BED_PEAK_DBFS }) {
  const frames = Object.values(stems)[0].L.length;
  const buses = channels.map((channel) => {
    const dry = new Float64Array(frames);
    const wet = {};
    for (const [stemName, side, gain, filter] of placement[channel]) {
      const stem = stems[stemName];
      if (!stem) throw new Error(`Placement names a missing stem: ${stemName}.`);
      if (stem.L.length !== frames) throw new Error(`Stem ${stemName} has a different length.`);
      const target = filter ? (wet[filter] ??= new Float64Array(frames)) : dry;
      const source = stemSide(stem, side);
      for (let index = 0; index < frames; index += 1) target[index] += gain * source[index];
    }
    for (const [filter, signal] of Object.entries(wet)) {
      filtfilt(signal, FILTERS[filter](sampleRateHz));
      for (let index = 0; index < frames; index += 1) dry[index] += signal[index];
    }
    return dry;
  });
  let peak = 0;
  for (const bus of buses) for (const value of bus) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 0 ? 10 ** (peakDbfs / 20) / peak : 1;
  const output = new Float32Array(frames * channels.length);
  for (let channel = 0; channel < channels.length; channel += 1) {
    const bus = buses[channel];
    for (let frame = 0; frame < frames; frame += 1) {
      output[frame * channels.length + channel] = bus[frame] * gain;
    }
  }
  return { samples: output, gain };
}

/**
 * Read the used stems listed in `source.stems.files` from `stemsDir`, refusing any whose SHA-256
 * differs. Returns stems keyed by name without the numeric prefix ("1 Drums.wav" -> "Drums"),
 * cropped to `range` frames.
 */
export async function readVerifiedStems(stemsDir, source, range) {
  const stems = {};
  let sampleRateHz = null;
  for (const { fileName, sha256, used } of source.stems.files) {
    if (!used) continue;
    const bytes = await readFile(join(stemsDir, fileName));
    const actual = sha256Hex(bytes);
    if (actual !== sha256) throw new Error(`${fileName} does not match its source.json hash.`);
    const stem = parsePcm16Stereo(bytes, range);
    sampleRateHz ??= stem.sampleRateHz;
    if (stem.sampleRateHz !== sampleRateHz) throw new Error(`${fileName} has another sample rate.`);
    stems[fileName.replace(/^\d+ /, "").replace(/\.wav$/, "")] = stem;
  }
  return { stems, sampleRateHz };
}
