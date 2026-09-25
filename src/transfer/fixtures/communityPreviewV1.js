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
export const COMMUNITY_PREVIEW_FIXTURE_V1 = deepFreeze({
  id: "plvs-community-stereo-v1",
  version: 1,
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
});
