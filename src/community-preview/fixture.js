import { buildStatsMetrics } from "../lib/statsCatalog.js";

const noop = () => {};

function keyed(value) {
  return new Proxy(Object.create(null), { get: () => value });
}

function spectrumResult(fixture) {
  return fixture.visuals.spectrum;
}

function vectorscopeHistory(fixture) {
  const rows = fixture.visuals.vectorscope.history.map(({ atMs, pairs }) => ({
    timestampMs: atMs,
    pairs: Float32Array.from(pairs),
  }));
  return {
    length: rows.length,
    version: 1,
    rowAt: (index) => rows[index],
    timestampAt: (index) => rows[index]?.timestampMs ?? Number.NaN,
  };
}

export function buildCommunityPreviewFixtureValues(fixture) {
  const frame = fixture.measurementFrame;
  const spectrum = spectrumResult(fixture);
  const vectorscope = vectorscopeHistory(fixture);
  const bands = spectrum.bandCentersHz.map((fCenter) => ({ fCenter }));
  const spectrogramRows = fixture.visuals.spectrogram.map(({ atMs, db }) => ({
    bands,
    dbList: db,
    timestampMs: atMs,
  }));
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
    mMax: frame.mMaxLufs,
    stMax: frame.stMaxLufs,
    lra: frame.loudness.rangeLu,
    tpMax: frame.loudness.truePeakDbtp,
    correlation: frame.correlation,
    sideToMidDb: frame.sideToMidDb,
    loudnessLayoutKnown: true,
    spectrumResultsByKey: keyed(spectrum),
    vectorscopeResultsByKey: keyed({
      path: fixture.visuals.vectorscope.path,
      correlation: fixture.visuals.vectorscope.correlation,
      sideToMidDb: fixture.visuals.vectorscope.sideToMidDb,
      pairX: fixture.visuals.vectorscope.pairX,
      pairY: fixture.visuals.vectorscope.pairY,
    }),
    stereoMapResultsByKey: keyed(fixture.visuals.stereoMap),
  };
  const histSourceList = fixture.loudnessHistory.map((row) => ({
    timestampMs: row.atMs,
    m: row.momentaryLufs,
    st: row.shortTermLufs,
    min: row.waveformMin,
    max: row.waveformMax,
    waveformMin: row.waveformMin,
    waveformMax: row.waveformMax,
  }));
  const visualWaveformHist = fixture.visuals.waveform.map((row) => ({
    timestampMs: row.atMs,
    waveformMin: row.min,
    waveformMax: row.max,
    dominantFrequencyHz: row.dominantFrequencyHz,
    spectralCentroidHz: row.spectralCentroidHz,
    tonality: row.tonality,
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
      showHistoryHud: noop,
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
      getVectorscopeHistoryForKey: () => vectorscope,
      getStereoMapHistoryForKey: () => null,
      captureCurrentSnapshot: noop,
      visualWaveformHist,
      waveformHistoryIndex: null,
    },
  };
}
