import { buildStatsMetrics } from "../lib/statsCatalog.js";

const noop = () => {};

function keyed(value) {
  return new Proxy(Object.create(null), { get: () => value });
}

function interpolateValue(left, right, fraction) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.map((value, index) => value + (right[index] - value) * fraction);
  }
  return left + (right - left) * fraction;
}

function expandTimeline(rows, clock, select) {
  const expanded = [];
  let upper = 1;
  for (let atMs = clock.startMs; atMs <= clock.durationMs; atMs += clock.frameIntervalMs) {
    while (upper < rows.length - 1 && rows[upper].atMs < atMs) upper += 1;
    const left = rows[Math.max(0, upper - 1)];
    const right = rows[upper] ?? left;
    const span = right.atMs - left.atMs;
    const fraction = span > 0 ? (atMs - left.atMs) / span : 0;
    expanded.push(select(left, right, fraction, atMs));
  }
  return expanded;
}

function spectrumResult(fixture) {
  const { bandCentersHz, smoothDb } = fixture.visuals.spectrum;
  return {
    bandCentersHz,
    smoothDb,
    peakDb: smoothDb.map((value) => value + 4),
    smoothDbB: smoothDb.map((value, index) => value - 3 + (index % 2)),
    peakDbB: smoothDb.map((value) => value + 1),
  };
}

export function buildCommunityPreviewFixtureValues(fixture) {
  const frame = fixture.measurementFrame;
  const spectrum = spectrumResult(fixture);
  const spectrogramRows = expandTimeline(
    fixture.visuals.spectrogram,
    fixture.clock,
    (left, right, fraction, atMs) => ({
      bands: spectrum.bandCentersHz.map((fCenter) => ({ fCenter })),
      dbList: interpolateValue(left.db, right.db, fraction),
      timestampMs: atMs,
    })
  );
  const spectrogramView = {
    length: spectrogramRows.length,
    version: 1,
    rowAt: (index) => spectrogramRows[index],
    timestampAt: (index) => spectrogramRows[index]?.timestampMs ?? Number.NaN,
  };
  const displayAudio = {
    peakDb: frame.peaksDbfs,
    rmsDb: frame.rmsDbfs,
    momentary: frame.loudness.momentaryLufs,
    shortTerm: frame.loudness.shortTermLufs,
    integrated: frame.loudness.integratedLufs,
    mMax: -15.5,
    stMax: -17.5,
    lra: frame.loudness.rangeLu,
    tpMax: frame.loudness.truePeakDbtp,
    correlation: 0.78,
    sideToMidDb: -8.2,
    loudnessLayoutKnown: true,
    spectrumResultsByKey: keyed(spectrum),
    vectorscopeResultsByKey: keyed({
      path: fixture.visuals.vectorscope.path,
      correlation: fixture.visuals.vectorscope.correlation,
      pairX: 0,
      pairY: 1,
    }),
    stereoMapResultsByKey: keyed(fixture.visuals.stereoMap),
  };
  const loudnessRows = expandTimeline(
    fixture.loudnessHistory,
    fixture.clock,
    (left, right, fraction, atMs) => ({
      atMs,
      momentaryLufs: interpolateValue(left.momentaryLufs, right.momentaryLufs, fraction),
      shortTermLufs: interpolateValue(left.shortTermLufs, right.shortTermLufs, fraction),
    })
  );
  const waveformRows = expandTimeline(
    fixture.visuals.waveform,
    fixture.clock,
    (left, right, fraction, atMs) => ({
      atMs,
      min: interpolateValue(left.min, right.min, fraction),
      max: interpolateValue(left.max, right.max, fraction),
      dominantHz: interpolateValue(left.dominantHz, right.dominantHz, fraction),
    })
  );
  const histSourceList = loudnessRows.map((row, index) => {
    const waveform = waveformRows[index];
    return {
      timestampMs: row.atMs,
      m: row.momentaryLufs,
      st: row.shortTermLufs,
      min: waveform.min,
      max: waveform.max,
      waveformMin: waveform.min,
      waveformMax: waveform.max,
    };
  });
  const visualWaveformHist = waveformRows.map((row) => ({
    timestampMs: row.atMs,
    waveformMin: row.min,
    waveformMax: row.max,
    dominantFrequencyHz: [row.dominantHz, row.dominantHz * 1.25],
    spectralCentroidHz: [row.dominantHz * 2, row.dominantHz * 2.25],
    tonality: [0.8, 0.72],
  }));
  const totalSamples = histSourceList.length;
  return {
    frameData: {
      displayAudio,
      channelCount: frame.channelCount,
      peakLabelContext: { labels: fixture.audio.channelLabels },
      hasTpMaxValue: true,
      onResetTpMax: noop,
      correlation: displayAudio.correlation,
      vectorscopePairX: 0,
      vectorscopePairY: 1,
      spectrumChannelOptions: fixture.audio.channelLabels.map((label, value) => ({ label, value })),
      vsGridDiagInset: 18,
      vsGridDiagFar: 82,
    },
    metricsData: {
      statsMetrics: buildStatsMetrics(displayAudio),
      dialogueActiveNow: false,
    },
    historyData: {
      hasHistoryData: true,
      historyChartInteractive: false,
      running: false,
      selectedOffset: -1,
      setSelectedOffset: noop,
      holdHistoryHud: noop,
      showHistoryHud: false,
      onHistoryWheel: noop,
      onHistoryPointerDown: noop,
      onHistoryPointerMove: noop,
      onHistoryPointerUp: noop,
      historyTimeAxisHandlers: {},
      historyTimeAxisActive: false,
      showSelLine: false,
      selectionEdge: null,
      selLineX: null,
      historyTimeTicks: [],
      effectiveOffsetSec: 0,
      histSourceList,
      loudnessDisplayIndex: null,
      effectiveOffsetSamples: 0,
      visibleSamples: totalSamples,
      totalSamples,
      referenceLufs: null,
      momentaryRules: [],
      shortTermRules: [],
      sourceMode: "file",
      frequencyMarkerRef: { current: null },
      frequencyMarkerIndex: -1,
      getSpectrogramSnapsForKey: () => spectrogramView,
      snapshotSpectrumByKey: {},
      resolveSpectrumSnapshotForKey: () => null,
      resolveVectorscopeSnapshotForKey: () => null,
      resolveStereoMapSnapshotForKey: () => null,
      getVectorscopeHistoryForKey: () => null,
      getStereoMapHistoryForKey: () => null,
      captureCurrentSnapshot: noop,
      visualWaveformHist,
      waveformHistoryIndex: null,
    },
  };
}
