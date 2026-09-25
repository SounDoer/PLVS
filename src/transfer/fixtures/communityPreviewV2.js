function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Golden input for every non-Theme Community preview. The renderer derives samples from these
// exact oscillator/envelope parameters instead of reading an audio device or a user file. Fixed
// summary frames keep rule evaluation and history labels stable even if DSP implementation details
// change; changing either half requires a new fixture version.
export const COMMUNITY_PREVIEW_FIXTURE_V2 = deepFreeze({
  id: "plvs-community-stereo-v2",
  version: 2,
  clock: { startMs: 0, durationMs: 15000, frameIntervalMs: 100 },
  audio: {
    sampleRateHz: 48000,
    channelLabels: ["L", "R"],
    generator: "seeded-sine-program-v1",
    seed: 20260925,
    oscillators: [
      { frequencyHz: 110, amplitude: 0.125, phaseTurns: 0 },
      { frequencyHz: 440, amplitude: 0.0625, phaseTurns: 0.25 },
      { frequencyHz: 1760, amplitude: 0.03125, phaseTurns: 0.5 },
    ],
    envelope: [
      { atMs: 0, gain: 0 },
      { atMs: 1000, gain: 0.5 },
      { atMs: 5000, gain: 1 },
      { atMs: 10000, gain: 0.75 },
      { atMs: 15000, gain: 0 },
    ],
  },
  measurementFrame: {
    sequence: 150,
    elapsedMs: 15000,
    channelCount: 2,
    sampleRateHz: 48000,
    peaksDbfs: [-1.25, -2.5],
    rmsDbfs: [-18.5, -19.25],
    loudness: {
      momentaryLufs: -17.5,
      shortTermLufs: -18.25,
      integratedLufs: -19,
      rangeLu: 6.5,
      truePeakDbtp: -1.25,
    },
  },
  loudnessHistory: [
    { atMs: 0, momentaryLufs: -36, shortTermLufs: -34 },
    { atMs: 3000, momentaryLufs: -22, shortTermLufs: -24 },
    { atMs: 6000, momentaryLufs: -17, shortTermLufs: -19 },
    { atMs: 9000, momentaryLufs: -15.5, shortTermLufs: -17.5 },
    { atMs: 12000, momentaryLufs: -19, shortTermLufs: -18 },
    { atMs: 15000, momentaryLufs: -24, shortTermLufs: -20 },
  ],
  visuals: {
    spectrum: {
      bandCentersHz: [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
      smoothDb: [-58, -47, -38, -31, -28, -30, -35, -42, -51, -63],
    },
    vectorscope: {
      path: "M 30 230 C 65 190 95 150 130 30 C 155 145 195 195 230 230",
      correlation: 0.78,
    },
    stereoMap: {
      bandCentersHz: [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
      pl: [0.12, 0.28, 0.46, 0.72, 0.88, 0.74, 0.52, 0.31, 0.14],
      pr: [0.1, 0.25, 0.42, 0.68, 0.82, 0.79, 0.58, 0.37, 0.18],
      c: [0.08, 0.18, 0.31, 0.5, 0.63, 0.55, 0.36, 0.2, 0.09],
    },
    waveform: [
      { atMs: 0, min: [-0.08, -0.06], max: [0.09, 0.07], dominantHz: 110 },
      { atMs: 3000, min: [-0.28, -0.22], max: [0.31, 0.25], dominantHz: 220 },
      { atMs: 6000, min: [-0.62, -0.48], max: [0.68, 0.54], dominantHz: 440 },
      { atMs: 9000, min: [-0.82, -0.67], max: [0.88, 0.72], dominantHz: 880 },
      { atMs: 12000, min: [-0.54, -0.46], max: [0.6, 0.5], dominantHz: 1760 },
      { atMs: 15000, min: [-0.2, -0.16], max: [0.23, 0.18], dominantHz: 3520 },
    ],
    spectrogram: [
      { atMs: 0, db: [-72, -65, -59, -53, -49, -52, -58, -66, -74, -82] },
      { atMs: 3000, db: [-64, -56, -47, -39, -34, -37, -44, -53, -63, -74] },
      { atMs: 6000, db: [-58, -48, -38, -29, -24, -27, -35, -45, -57, -69] },
      { atMs: 9000, db: [-55, -45, -35, -26, -21, -24, -32, -42, -54, -66] },
      { atMs: 12000, db: [-60, -51, -42, -34, -29, -32, -39, -48, -59, -71] },
      { atMs: 15000, db: [-68, -60, -53, -47, -43, -46, -52, -60, -69, -78] },
    ],
  },
});
